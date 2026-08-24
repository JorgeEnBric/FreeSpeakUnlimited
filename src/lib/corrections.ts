import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { isRunning, ensureStarted, complete } from './llamaServer';
import { findLlamaCli, getLlamaBinDir, getGemmaModelPath } from './modelConfig';
import { PATTERN_LIST, CORRECTIONS_SYSTEM_PROMPT } from './prompts';

const TEMP_DIR = join(process.cwd(), 'temp');

let messageQueue: number[] = [];
let isCurrentlyAnalyzing = false;

export function isAnalyzing(): boolean {
  return isCurrentlyAnalyzing;
}

export function getQueueLength(): number {
  return messageQueue.length;
}

export function notifyNewMessage(messageId: number): void {
  messageQueue.push(messageId);
  processNext().catch(err => {
    console.error('[Corrections] Error in processNext:', err);
    isCurrentlyAnalyzing = false;
  });
}

async function processNext(): Promise<void> {
  if (isCurrentlyAnalyzing || messageQueue.length === 0) return;

  isCurrentlyAnalyzing = true;
  const messageId = messageQueue.shift()!;

  try {
    await analyzeSingleMessage(messageId);
  } catch (error) {
    console.error(`[Corrections] Error analyzing msg ${messageId}:`, error);
    try {
      const { insertLog, markAnalyzed } = await import('./database');
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await insertLog('corrections', `ERROR analyzing msg ${messageId}: ${msg}`);
      await markAnalyzed([messageId]);
    } catch (_) {
      // Ignore errors
    }
  } finally {
    isCurrentlyAnalyzing = false;
    processNext();
  }
}

async function analyzeSingleMessage(messageId: number): Promise<void> {
  console.log(`[Corrections] Analyzing message ${messageId}...`);
  const { initDB, getMessageById, insertCorrection, markAnalyzed, insertLog } = await import('./database');
  await initDB();

  try {
    const message = await getMessageById(messageId);
    if (!message) {
      console.error(`[Corrections] Message ${messageId} not found`);
      return;
    }
    console.log(`[Corrections] Message ${messageId}: "${message.text.substring(0, 50)}..."`);

    const subSentences: string[] = message.text.split('\n').filter(s => s.trim().length > 0);
    if (subSentences.length === 0) return;

    const sentences = subSentences.map(s => `"${s.trim()}"`).join('\n');
    const systemPrompt = CORRECTIONS_SYSTEM_PROMPT;
    const userPrompt = `Review each sentence and find ALL grammar mistakes. Fix them to produce natural, idiomatic English. Use EXACTLY this format (no extra labels, no bold markers in values):\n**Correction:** complete corrected sentence\n**Pattern:** PATTERN_CODE\n\nUse only these Pattern codes: ${PATTERN_LIST.join(', ')}\n\nSentences to review:\n${sentences}`;

    let raw = '';
    await ensureStarted();
    if (isRunning()) {
      console.log(`[Corrections] Calling LLM for message ${messageId}...`);
      const result = await complete(userPrompt, systemPrompt, { n_predict: 60, timeoutMs: 180000 });
      if (result) raw = result;
      console.log(`[Corrections] LLM response length: ${raw.length}`);
    } else {
      console.log(`[Corrections] LLM server not running for message ${messageId}`);
    }

    if (!raw) {
      const modelPath = getGemmaModelPath();
      const llamaCli = findLlamaCli();
      if (!existsSync(llamaCli)) {
        console.log(`[Corrections] llama-cli.exe not found, marking as analyzed without corrections`);
        await insertLog('corrections', `llama-cli.exe not found for msg ${messageId}`);
        return;
      }
      console.log(`[Corrections] Falling back to CLI for message ${messageId}...`);
      const ts = Date.now();
      const outFile = join(TEMP_DIR, `corr-${ts}.txt`);
      execFileSync(llamaCli, [
        '-m', modelPath,
        '-sys', systemPrompt,
        '-p', userPrompt,
        '-o', outFile,
        '-n', '60',
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

    await insertLog('corrections', `Raw model output (msg ${messageId}):\n${raw.substring(0, 2000)}`);

    const asstIdx = raw.lastIndexOf('Assistant:');
    const body = asstIdx !== -1 ? raw.substring(asstIdx + 'Assistant:'.length).trim() : raw;

    // Usar **Correction:** como separador, original tomado de subSentences por índice
    const corrMarker = '**Correction:**';
    const blocks: string[] = [];
    let cursor = 0;
    while (true) {
      const startIdx = body.indexOf(corrMarker, cursor);
      if (startIdx === -1) break;
      const blockStart = startIdx + corrMarker.length;
      const nextIdx = body.indexOf(corrMarker, blockStart);
      const block = (nextIdx !== -1 ? body.substring(blockStart, nextIdx) : body.substring(blockStart)).trim();
      if (block.length >= 5) blocks.push(block);
      cursor = nextIdx !== -1 ? nextIdx : body.length;
    }

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

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      // block ya empieza después de **Correction:**, correction hasta Pattern
      let patIdx = block.indexOf(patLabel);
      if (patIdx === -1) patIdx = block.indexOf(patCodeLabel);
      const correction = (patIdx !== -1 ? block.substring(0, patIdx) : block).replace(/\*\*/g, '').trim();
      let patternRaw = extractAfter(patLabel, block, []).trim();
      if (!patternRaw) patternRaw = extractAfter(patCodeLabel, block, []).trim();
      const patterns = patternRaw.split(',').map(p => p.trim()).filter(p => PATTERN_LIST.includes(p));
      const pattern = patterns.length > 0 ? patterns[0] : 'OTHER';
      const original = subSentences[i] ?? message.text;

      await insertLog('corrections', `msg ${messageId} pattern=${pattern} corr="${correction.substring(0,60)}" orig="${original.substring(0,40)}"`);

      if (correction) {
        await insertCorrection(messageId, original, correction, pattern);
      }
    }
    if (blocks.length !== subSentences.length) {
      await insertLog('corrections', `WARN msg ${messageId}: blocks ${blocks.length} != sentences ${subSentences.length}, raw len ${raw.length}`);
    }

    console.log(`[Corrections] Message ${messageId} processed (${blocks.length} blocks found)`);
  } finally {
    await markAnalyzed([messageId]);
    console.log(`[Corrections] Message ${messageId} marked as analyzed`);
  }
}
