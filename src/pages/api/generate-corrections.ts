import type { APIRoute } from 'astro';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { isRunning, ensureStarted, complete } from '../../lib/llamaServer';
import { PATTERN_LIST, CORRECTIONS_SYSTEM_PROMPT } from '../../lib/prompts';

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

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const { initDB, getPendingMessages, insertCorrection, markAnalyzed, getCorrectionsByPattern, getUnanalyzedCount, insertLog } = await import('../../lib/database');
    await initDB();

    const pending = await getPendingMessages();
    if (pending.length === 0) {
      const corrections = await getCorrectionsByPattern();
      return new Response(JSON.stringify({ corrections, unanalyzed: 0 }), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    // Split multi-sentence messages so the model sees each sentence separately
    const subSentences: { msgId: number; text: string }[] = [];
    for (const msg of pending) {
      const parts = msg.text.split('\n').filter(s => s.trim().length > 0);
      for (const part of parts) {
        subSentences.push({ msgId: msg.id, text: part.trim() });
      }
    }
    const sentences = subSentences.map(s => `"${s.text}"`).join('\n');
    const systemPrompt = CORRECTIONS_SYSTEM_PROMPT;
    const userPrompt = `Review each sentence and find ALL grammar mistakes. Fix them to produce natural, idiomatic English. Use EXACTLY this format (no extra labels, no bold markers in values):\n**Sentence:** exact original text (copy verbatim, do NOT correct it)\n**Correction:** complete corrected sentence\n**Tip:** what was wrong and why\n**Pattern:** PATTERN_CODE\n\nUse only these Pattern codes: ${PATTERN_LIST.join(', ')}\n\nSentences to review:\n${sentences}`;

    let raw = '';
    // Try server first (persistent, keeps system prompt cached)
    await ensureStarted();
    if (isRunning()) {
      const result = await complete(userPrompt, systemPrompt, { n_predict: 70 });
      if (result) raw = result;
    }

    // Fallback to CLI
    if (!raw) {
      const modelPath = getGemmaModelPath();
      const llamaCli = findLlamaCli();
      if (!existsSync(llamaCli)) {
        return new Response(JSON.stringify({ error: 'llama-cli.exe not found' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      const ts = Date.now();
      const outFile = join(TEMP_DIR, `corr-${ts}.txt`);
      execFileSync(llamaCli, [
        '-m', modelPath,
        '-sys', systemPrompt,
        '-p', userPrompt,
        '-o', outFile,
        '-n', '70',
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
      if (existsSync(outFile)) {
        raw = readFileSync(outFile, 'utf8').trim();
      }
      try { unlinkSync(outFile); } catch (_) {}
    }

    await insertLog('corrections', `Raw model output:\n${raw.substring(0, 2000)}`);

    // Extract after "Assistant:" to strip the User prompt echo
    const asstIdx = raw.lastIndexOf('Assistant:');
    const body = asstIdx !== -1 ? raw.substring(asstIdx + 'Assistant:'.length).trim() : raw;
    await insertLog('corrections', `Extracted body (first 500):\n${body.substring(0, 500)}`);

    // Parse all **Sentence:** blocks from model output (may not match 1:1 with pending)
    const sentMarker = '**Sentence:**';
    const blocks: string[] = [];
    let cursor = 0;
    while (true) {
      const startIdx = body.indexOf(sentMarker, cursor);
      if (startIdx === -1) break;
      const blockStart = startIdx + sentMarker.length;
      const nextIdx = body.indexOf(sentMarker, blockStart);
      const block = (nextIdx !== -1 ? body.substring(blockStart, nextIdx) : body.substring(blockStart)).trim();
      if (block.length >= 5) blocks.push(block);
      cursor = nextIdx !== -1 ? nextIdx : body.length;
    }

    const corrLabel = '**Correction:**';
    const tipLabel = '**Tip:**';
    const patLabel = '**Pattern:**';
    const patCodeLabel = '**Pattern Code:**';

    function extractAfter(label: string, text: string, endLabels: string[]): string {
      const start = text.indexOf(label);
      if (start === -1) return '';
      const valStart = start + label.length;
      let valEnd = text.length;
      for (const el of endLabels) {
        const ei = text.indexOf(el, valStart);
        if (ei !== -1 && ei < valEnd) valEnd = ei;
      }
      return text.substring(valStart, valEnd).trim();
    }

    // For each block, find the matching message (allow multiple blocks per message)
    const analyzedIds: number[] = [];

    for (const block of blocks) {
      const sentText = extractAfter('', block, [corrLabel]).replace(/\*\*/g, '').trim();
      const correction = extractAfter(corrLabel, block, [tipLabel, patLabel, patCodeLabel]).replace(/\*\*/g, '').trim();
      const tip = extractAfter(tipLabel, block, [patLabel, patCodeLabel]).replace(/\*\*/g, '').trim();
      let patternRaw = extractAfter(patLabel, block, []).trim();
      if (!patternRaw) patternRaw = extractAfter(patCodeLabel, block, []).trim();
      const patterns = patternRaw.split(',').map(p => p.trim()).filter(p => PATTERN_LIST.includes(p));
      const pattern = patterns.length > 0 ? patterns[0] : 'OTHER';

      // Find message whose text contains this block's sentence text
      let matchedMsg: typeof pending[0] | null = null;
      for (const msg of pending) {
        const msgText = msg.text.replace(/\r?\n/g, ' ').trim();
        if (msgText.includes(sentText) || sentText.includes(msgText)) {
          matchedMsg = msg;
          break;
        }
      }

      if (!matchedMsg) {
        // Fallback: pick the first message whose analyzed status wasn't set yet
        const unset = pending.find(m => !analyzedIds.includes(m.id));
        if (unset) {
          matchedMsg = unset;
          await insertLog('corrections', `Fallback match: id=${unset.id} for "${sentText.substring(0,60)}"`);
        } else {
          await insertLog('corrections', `No message matched: "${sentText.substring(0,60)}"`);
          continue;
        }
      }

      await insertLog('corrections', `msg ${matchedMsg.id} pattern=${pattern} corr="${correction.substring(0,60)}" tip="${tip.substring(0,60)}"`);

      if (correction || tip) {
        await insertCorrection(matchedMsg.id, matchedMsg.text, correction, tip, pattern);
      }
    }

    // Mark all pending messages as analyzed
    for (const msg of pending) analyzedIds.push(msg.id);
    await markAnalyzed(analyzedIds);
    const corrections = await getCorrectionsByPattern();

    return new Response(JSON.stringify({ corrections, unanalyzed: 0 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await insertLog('corrections', `ERROR: ${msg}`);
    return new Response(JSON.stringify({ error: msg, unanalyzed: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
};