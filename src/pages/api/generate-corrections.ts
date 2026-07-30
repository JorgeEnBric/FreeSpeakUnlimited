import type { APIRoute } from 'astro';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const MODELS_DIR = join(process.cwd(), 'src', 'models');
const TEMP_DIR = join(process.cwd(), 'temp');
const LLAMA_BIN_DIRS = [
  join(MODELS_DIR, 'llama-b10182-bin-win-cpu-x64'),
  join(MODELS_DIR, 'llama-b10182'),
];
function findLlamaCli(): string {
  for (const dir of LLAMA_BIN_DIRS) {
    const candidate = join(dir, 'llama-cli.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'llama-cli.exe';
}
function getLlamaBinDir(): string {
  for (const dir of LLAMA_BIN_DIRS) {
    if (existsSync(join(dir, 'llama-cli.exe'))) return dir;
  }
  return LLAMA_BIN_DIRS[0];
}
function getGemmaModelPath(): string {
  const candidates = [
    join(MODELS_DIR, 'llama-b10182', 'gemma-2-2b-it-q4_k_m.gguf'),
    join(MODELS_DIR, 'llama-b10182', '2b_it_v1p1.gguf'),
    join(MODELS_DIR, 'llama-b10182', 'gemma-1.1-2b-it-cpu-int4.gguf'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0];
}

const PATTERN_LIST = [
  'VERB_TENSE', 'PREPOSITIONS', 'AGE_EXPRESSION', 'CONNECTORS',
  'REDUNDANCY', 'NATURAL_EXPRESSION', 'VOCABULARY_CHOICE', 'COLLOCATIONS',
  'COMPARATIVES_SUPERLATIVES', 'COUNTABLE_UNCOUNTABLE', 'AUXILIARY_VERBS',
  'WORD_ORDER', 'PRONOUNS', 'PLURALS', 'ARTICLES', 'OTHER'
];

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const { initDB, getPendingMessages, insertCorrection, markAnalyzed, getCorrectionsByPattern, getUnanalyzedCount } = await import('../../lib/database');
    await initDB();

    const pending = await getPendingMessages();
    if (pending.length === 0) {
      const corrections = await getCorrectionsByPattern();
      return new Response(JSON.stringify({ corrections, unanalyzed: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const modelPath = getGemmaModelPath();
    const llamaCli = findLlamaCli();
    if (!existsSync(llamaCli)) {
      return new Response(JSON.stringify({ error: 'llama-cli.exe not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const sentences = pending.map(m => `"${m.text}"`).join('\n');
    const systemPrompt = 'You are an English teacher. Classify each grammar error with one of these pattern codes: ' + PATTERN_LIST.join(', ');
    const userPrompt = `Review these sentences and for each one find grammar mistakes. Format each result as:\n**Sentence:** original text\n**Correction:** corrected version\n**Tip:** brief explanation\n**Pattern:** PATTERN_CODE\n\nSentences:\n${sentences}`;

    const ts = Date.now();
    const outFile = join(TEMP_DIR, `corr-${ts}.txt`);
    execFileSync(llamaCli, [
      '-m', modelPath,
      '-sys', systemPrompt,
      '-p', userPrompt,
      '-o', outFile,
      '-n', '500',
      '--temp', '0.3',
      '--repeat-penalty', '1.0',
      '--single-turn',
      '--simple-io',
    ], {
      timeout: 180000,
      cwd: getLlamaBinDir(),
      env: { ...process.env, PATH: `${getLlamaBinDir()};${process.env.PATH}` },
      stdio: 'pipe',
    });

    let raw = '';
    if (existsSync(outFile)) {
      raw = readFileSync(outFile, 'utf8').trim();
    }
    try { unlinkSync(outFile); } catch (_) {}

    // Parse model response
    const blocks = raw.split(/\*\*Sentence:\*\*/).filter(Boolean);
    const analyzedIds: number[] = [];

    for (let i = 0; i < blocks.length && i < pending.length; i++) {
      const block = blocks[i];
      const original = block.match(/(.*?)(?:\*\*Correction:\*\*|$)/s)?.[1]?.trim() || pending[i].text;
      const correction = block.match(/\*\*Correction:\*\*(.*?)(?:\*\*Tip:\*\*|$)/s)?.[1]?.trim() || '';
      const tip = block.match(/\*\*Tip:\*\*(.*?)(?:\*\*Pattern:\*\*|$)/s)?.[1]?.trim() || '';
      const pattern = block.match(/\*\*Pattern:\*\*(.*)/s)?.[1]?.trim() || 'OTHER';
      const validPattern = PATTERN_LIST.includes(pattern) ? pattern : 'OTHER';

      if (correction || tip) {
        await insertCorrection(pending[i].id, original, correction, tip, validPattern);
      }
      analyzedIds.push(pending[i].id);
    }

    await markAnalyzed(analyzedIds);
    const corrections = await getCorrectionsByPattern();

    return new Response(JSON.stringify({ corrections, unanalyzed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Correction generation error:', msg);
    return new Response(JSON.stringify({ error: msg, unanalyzed: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};