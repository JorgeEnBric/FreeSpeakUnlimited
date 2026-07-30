import type { APIRoute } from 'astro';
import { existsSync, readFileSync, unlinkSync, appendFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const MODELS_DIR = join(process.cwd(), 'src', 'models');
const TRACE_FILE = join(process.cwd(), 'UserSpeach.trace');
const TRACE_TIPS = join(process.cwd(), 'Tips.trace');
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

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const modelPath = getGemmaModelPath();
    const llamaCli = findLlamaCli();
    if (!existsSync(llamaCli)) {
      return new Response(JSON.stringify({ error: 'llama-cli.exe not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    let traceContent = '';
    if (existsSync(TRACE_FILE)) {
      traceContent = readFileSync(TRACE_FILE, 'utf8').trim();
    }

    if (!traceContent) {
      return new Response(JSON.stringify({ error: 'No speech data found. Start speaking first!' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const systemPrompt = `You are an English teacher. Review the student's sentences and provide grammar corrections and tips. Be concise and encouraging.`;
    const userPrompt = `Review these English sentences and provide corrections and tips for each one:\n\n${traceContent}\n\nFor each sentence, give: the correction (if needed) and a brief grammar tip. Format each entry as:\n**Sentence:** ...\n**Correction:** ...\n**Tip:** ...`;

    const ts = Date.now();
    const outFile = join(TEMP_DIR, `corr-${ts}.txt`);
    execFileSync(llamaCli, [
      '-m', modelPath,
      '-sys', systemPrompt,
      '-p', userPrompt,
      '-o', outFile,
      '-n', '400',
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

    let result = '';
    if (existsSync(outFile)) {
      result = readFileSync(outFile, 'utf8').trim();
    }
    try { unlinkSync(outFile); } catch (_) {}

    // Append corrections to Tips.trace and clear UserSpeach.trace
    if (result) {
      // Extract only the Assistant response (after "Assistant:")
      const asstIdx = result.indexOf('Assistant:');
      const cleanResult = asstIdx !== -1 ? result.substring(asstIdx + 'Assistant:'.length).trim() : result;
      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
      appendFileSync(TRACE_TIPS, `\n=== ${timestamp} ===\n${cleanResult}\n`, 'utf8');
      writeFileSync(TRACE_FILE, '', 'utf8');
      result = cleanResult;
    }

    return new Response(JSON.stringify({ corrections: result || 'No corrections generated.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Correction generation error:', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};