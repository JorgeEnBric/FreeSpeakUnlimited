import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { isRunning, ensureStarted, complete } from './llamaServer';
import { findLlamaCli, getLlamaBinDir, getGemmaModelPath } from './modelConfig';
import { PATTERN_LIST, CORRECTIONS_SYSTEM_PROMPT } from './prompts';

const TEMP_DIR = join(process.cwd(), 'temp');

let debateQueue: number[] = [];
let isDebateAnalyzing = false;
const debateQueuedAt = new Map<number, number>();

export function isDebateAnalyzing_(): boolean {
  return isDebateAnalyzing;
}

export function getDebateQueueLength(): number {
  return debateQueue.length;
}

export function notifyDebateMessage(debateId: number): void {
  debateQueuedAt.set(debateId, Date.now());
  debateQueue.push(debateId);
  processNextDebate().catch(err => {
    console.error('[DebateCorrections] Error in processNext:', err);
    isDebateAnalyzing = false;
  });
}

async function processNextDebate(): Promise<void> {
  if (isDebateAnalyzing || debateQueue.length === 0) return;

  isDebateAnalyzing = true;
  const debateId = debateQueue.shift()!;

  try {
    await analyzeDebateMessage(debateId);
  } catch (error) {
    console.error(`[DebateCorrections] Error analyzing debate ${debateId}:`, error);
    try {
      const { insertLog, markDebateAnalyzed } = await import('./database');
      const msg = error instanceof Error ? error.message : 'Unknown error';
      await insertLog('debate_corrections', `ERROR analyzing debate ${debateId}: ${msg}`);
      await markDebateAnalyzed([debateId]);
    } catch (_) {}
  } finally {
    isDebateAnalyzing = false;
    processNextDebate();
  }
}

async function analyzeDebateMessage(debateId: number): Promise<void> {
  const tQueued = debateQueuedAt.get(debateId);
  debateQueuedAt.delete(debateId);
  const tStart = tQueued ?? Date.now();
  console.log(`[DebateCorrections] Analyzing debate ${debateId}...`);
  const { initDB, getDebateById, insertDebateCorrection, markDebateAnalyzed, insertLog } = await import('./database');
  await initDB();

  try {
    const debate = await getDebateById(debateId);
    if (!debate) {
      console.error(`[DebateCorrections] Debate ${debateId} not found`);
      return;
    }
    console.log(`[DebateCorrections] Debate ${debateId}: "${debate.text.substring(0, 50)}..."`);

    const subSentences: string[] = debate.text.split('\n').filter(s => s.trim().length > 0);
    if (subSentences.length === 0) {
      // Fallback: split by sentences if no newlines
      const byPeriod = debate.text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0);
      if (byPeriod.length > 0) subSentences.push(...byPeriod);
      if (subSentences.length === 0) return;
    }

    const sentences = subSentences.map(s => `"${s.trim()}"`).join('\n');
    const systemPrompt = CORRECTIONS_SYSTEM_PROMPT;
    const userPrompt = `Review each sentence and find ALL grammar mistakes. Fix them to produce natural, idiomatic English. Use EXACTLY this format (no extra labels, no bold markers in values):\n**Correction:** complete corrected sentence\n**Pattern:** PATTERN_CODE\n\nUse only these Pattern codes: ${PATTERN_LIST.join(', ')}\n\nSentences to review:\n${sentences}`;

    let raw = '';
    await ensureStarted();
    if (isRunning()) {
      console.log(`[DebateCorrections] Calling LLM for debate ${debateId}...`);
      const result = await complete(userPrompt, systemPrompt, { n_predict: 120, timeoutMs: 180000 });
      if (result) raw = result;
      console.log(`[DebateCorrections] LLM response length: ${raw.length}`);
    } else {
      console.log(`[DebateCorrections] LLM server not running for debate ${debateId}`);
    }

    if (!raw) {
      const modelPath = getGemmaModelPath();
      const llamaCli = findLlamaCli();
      if (!existsSync(llamaCli)) {
        console.log(`[DebateCorrections] llama-cli.exe not found`);
        await insertLog('debate_corrections', `llama-cli.exe not found for debate ${debateId}`);
        return;
      }
      console.log(`[DebateCorrections] Falling back to CLI for debate ${debateId}...`);
      const ts = Date.now();
      const outFile = join(TEMP_DIR, `debate-corr-${ts}.txt`);
      // @ts-ignore execFileSync types
      const { execFileSync } = await import('child_process');
      execFileSync(llamaCli, [
        '-m', modelPath,
        '-sys', systemPrompt,
        '-p', userPrompt,
        '-o', outFile,
        '-n', '120',
        '--temp', '0.3',
        '--repeat-penalty', '1.0',
        '--single-turn',
        '--simple-io',
      ], {
        timeout: 180000,
        cwd: getLlamaBinDir(),
        env: { ...process.env, PATH: `${getLlamaBinDir()};${process.env.PATH}` },
        stdio: 'pipe',
      } as any);
      if (existsSync(outFile)) {
        raw = readFileSync(outFile, 'utf8').trim();
      }
      try { unlinkSync(outFile); } catch (_) {}
    }

    const processingMs = Date.now() - tStart;
    await insertLog('debate_corrections', `Raw model output (debate ${debateId}):\n${raw.substring(0, 2000)}`);

    const asstIdx = raw.lastIndexOf('Assistant:');
    const body = asstIdx !== -1 ? raw.substring(asstIdx + 'Assistant:'.length).trim() : raw;
    const corrMarker = '**Correction:**';
    const corrBlocks: string[] = [];
    let cursor = 0;
    while (true) {
      const startIdx = body.indexOf(corrMarker, cursor);
      if (startIdx === -1) break;
      const blockStart = startIdx + corrMarker.length;
      const nextIdx = body.indexOf(corrMarker, blockStart);
      const block = (nextIdx !== -1 ? body.substring(blockStart, nextIdx) : body.substring(blockStart)).trim();
      if (block.length >= 5) corrBlocks.push(block);
      cursor = nextIdx !== -1 ? nextIdx : body.length;
    }

    // Fallback: el modelo a veces omite **Correction:** y solo emite el texto corregido seguido de **Pattern:**
    if (corrBlocks.length === 0 && body.indexOf('**Pattern:**') !== -1) {
      const patIdx = body.indexOf('**Pattern:**');
      let correctionText = body.substring(0, patIdx).replace(/\*\*/g, '').trim();
      if (correctionText.length >= 5) corrBlocks.push(correctionText);
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

    for (let i = 0; i < corrBlocks.length; i++) {
      const block = corrBlocks[i];
      let patIdx = block.indexOf(patLabel);
      if (patIdx === -1) patIdx = block.indexOf(patCodeLabel);
      const correction = (patIdx !== -1 ? block.substring(0, patIdx) : block).replace(/\*\*/g, '').trim();
      let patternRaw = extractAfter(patLabel, block, []).trim();
      if (!patternRaw) patternRaw = extractAfter(patCodeLabel, block, []).trim();
      const patterns = patternRaw.split(',').map(p => p.trim()).filter(p => PATTERN_LIST.includes(p));
      const pattern = patterns.length > 0 ? patterns[0] : 'OTHER';
      const original = subSentences[i] ?? debate.text;

      await insertLog('debate_corrections', `debate ${debateId} pattern=${pattern} corr="${correction.substring(0,60)}" orig="${original.substring(0,40)}" processingMs=${processingMs}`);

      if (correction) {
        await insertDebateCorrection(debateId, original, correction, pattern, processingMs);
      }
    }
    if (corrBlocks.length !== subSentences.length) {
      await insertLog('debate_corrections', `WARN debate ${debateId}: blocks ${corrBlocks.length} != sentences ${subSentences.length}, raw len ${raw.length}`);
    }

    console.log(`[DebateCorrections] Debate ${debateId} processed (${corrBlocks.length} blocks found) in ${processingMs}ms`);
  } finally {
    await markDebateAnalyzed([debateId]);
    console.log(`[DebateCorrections] Debate ${debateId} marked as analyzed`);
  }
}
