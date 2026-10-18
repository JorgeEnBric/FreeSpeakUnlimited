import type { APIRoute } from 'astro';
import { VERB_ROTATOR_SYSTEM_PROMPT, VERB_ROTATOR_REFRESH_PROMPT } from '../../lib/prompts';

export const prerender = false;

const FALLBACK_VERBS = [
  'get — obtener/conseguir | get along with — llevarse bien con',
  'take — tomar/llevar | take care of — cuidar de',
  'make — hacer/crear | make up with — reconciliarse con',
  'look — mirar | look forward to — esperar con ansias',
  'put — poner | put off — posponer',
  'turn — girar | turn down — rechazar/bajar',
  'come — venir | come across — encontrarse con',
  'go — ir | go on — continuar',
  'give — dar | give up — rendirse',
  'run — correr | run into — encontrarse por casualidad',
  'bring — traer | bring up — mencionar/criar',
  'set — colocar | set up — configurar',
];

function fallback(previous: string): string {
  const available = FALLBACK_VERBS.filter((v) => v !== previous);
  const pool = available.length ? available : FALLBACK_VERBS;
  return pool[Math.floor(Math.random() * pool.length)];
}

export const GET: APIRoute = async ({ url }) => {
  const previous = url.searchParams.get('prev')?.trim() || '';
  let n = parseInt(url.searchParams.get('n') || '', 10);
  if (!Number.isFinite(n) || n < 1) n = Math.floor(Date.now() / 60000);

  try {
    const { checkModels } = await import('../../lib/modelManager');
    const modelStatus = checkModels();
    if (!modelStatus.gemma) {
      return json({ entry: fallback(previous) });
    }

    const { ensureStarted, isRunning, complete } = await import('../../lib/llamaServer');
    await ensureStarted();

    if (isRunning()) {
      const prompt = VERB_ROTATOR_REFRESH_PROMPT(n, previous);
      const result = await complete(prompt, VERB_ROTATOR_SYSTEM_PROMPT, {
        n_predict: 60,
        temperature: 0.9,
        repeat_penalty: 1.15,
        timeoutMs: 30000,
      });
      if (result) {
        const entry = result
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .pop()
          ?.replace(/^["'`]|["'`]$/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (entry && entry.includes('|') && entry.length < 200 && isValidEntry(entry)) {
          return json({ entry });
        }
      }
    }

    return json({ entry: fallback(previous) });
  } catch (error) {
    console.error('Verb rotator error:', error);
    return json({ entry: fallback(previous) });
  }
};

function isValidEntry(entry: string): boolean {
  const parts = entry.split('|');
  if (parts.length !== 2) return false;
  const verb = (parts[0].split('—')[0] || '').trim().toLowerCase();
  const phrasal = (parts[1].split('—')[0] || '').trim().toLowerCase();
  if (!verb || !phrasal) return false;
  const base = verb.split(/\s+/)[0];
  return phrasal.startsWith(base);
}

function json(payload: { entry: string }): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
