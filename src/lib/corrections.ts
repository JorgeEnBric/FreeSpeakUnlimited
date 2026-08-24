import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { isRunning, ensureStarted, complete } from './llamaServer';
import { findLlamaCli, getLlamaBinDir, getGemmaModelPath } from './modelConfig';
import { PATTERN_LIST, CORRECTIONS_SYSTEM_PROMPT } from './prompts';

const TEMP_DIR = join(process.cwd(), 'temp');

let analyzing = false;

export function isAnalyzing(): boolean {
  return analyzing;
}

export async function analyzePendingCorrections(): Promise<void> {
  if (analyzing) return;
  analyzing = true;

  try {
    const { initDB, getPendingMessages, insertCorrection, markAnalyzed, insertLog } = await import('./database');
    await initDB();

    const pending = await getPendingMessages();
    if (pending.length === 0) return;

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
    await ensureStarted();
    if (isRunning()) {
      const result = await complete(userPrompt, systemPrompt, { n_predict: 150 });
      if (result) raw = result;
    }

    if (!raw) {
      const modelPath = getGemmaModelPath();
      const llamaCli = findLlamaCli();
      if (!existsSync(llamaCli)) {
        await insertLog('corrections', 'llama-cli.exe not found');
        return;
      }
      const ts = Date.now();
      const outFile = join(TEMP_DIR, `corr-${ts}.txt`);
      execFileSync(llamaCli, [
        '-m', modelPath,
        '-sys', systemPrompt,
        '-p', userPrompt,
        '-o', outFile,
        '-n', '150',
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

    const asstIdx = raw.lastIndexOf('Assistant:');
    const body = asstIdx !== -1 ? raw.substring(asstIdx + 'Assistant:'.length).trim() : raw;
    await insertLog('corrections', `Extracted body (first 500):\n${body.substring(0, 500)}`);

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

    const analyzedIds: number[] = [];

    for (const block of blocks) {
      const sentText = extractAfter('', block, [corrLabel]).replace(/\*\*/g, '').trim();
      const correction = extractAfter(corrLabel, block, [tipLabel, patLabel, patCodeLabel]).replace(/\*\*/g, '').trim();
      const tip = extractAfter(tipLabel, block, [patLabel, patCodeLabel]).replace(/\*\*/g, '').trim();
      let patternRaw = extractAfter(patLabel, block, []).trim();
      if (!patternRaw) patternRaw = extractAfter(patCodeLabel, block, []).trim();
      const patterns = patternRaw.split(',').map(p => p.trim()).filter(p => PATTERN_LIST.includes(p));
      const pattern = patterns.length > 0 ? patterns[0] : 'OTHER';

      let matchedMsg: typeof pending[0] | null = null;
      for (const msg of pending) {
        const msgText = msg.text.replace(/\r?\n/g, ' ').trim();
        if (msgText.includes(sentText) || sentText.includes(msgText)) {
          matchedMsg = msg;
          break;
        }
      }

      if (!matchedMsg) {
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

    for (const msg of pending) analyzedIds.push(msg.id);
    await markAnalyzed(analyzedIds);
  } catch (error) {
    const { insertLog } = await import('./database');
    const msg = error instanceof Error ? error.message : 'Unknown error';
    await insertLog('corrections', `ERROR: ${msg}`);
  } finally {
    analyzing = false;
  }
}
