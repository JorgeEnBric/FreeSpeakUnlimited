import type { APIRoute } from 'astro';
import { addLog } from '../../lib/log-store';
import { DICE_CONTINUE_SYSTEM_PROMPT, DICE_CONTINUE_PROMPT, DICE_SUGGESTIONS_SYSTEM_PROMPT } from '../../lib/prompts';
import { getStructureByCode, pickFallbackAnswers } from '../../lib/dice';

export const prerender = false;

const DRAIN_SILENCE_MS = 2000;
const NO_AUDIO_TIMEOUT_MS = 2500;
const MAX_DRAIN_MS = 8000;

const FALLBACK_REPLY = 'Nice answer! Can you tell me a little more about that?';

function parseSuggestions(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .map((line) =>
      line
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[.)]\s*/, '')
        .replace(/\*\*/g, '')
        .replace(/^["'`]+|["'`]+$/g, '')
        .trim(),
    )
    .filter((line) => line.length >= 5)
    .slice(0, 3);
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const code = body.code?.trim() ?? '';
    const question = body.question?.trim() ?? '';
    const text = body.text?.trim() ?? '';
    const history = Array.isArray(body.history) ? body.history : [];

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const structure = getStructureByCode(code);
    const structureLabel = structure?.label ?? 'the target structure';
    const hint = structure?.hint ?? '';

    const { checkModels } = await import('../../lib/modelManager');
    checkModels();

    const { ensureStarted, isRunning, completeStream, complete } = await import('../../lib/llamaServer');
    const { ensurePiperStarted, isPiperRunning, writeSentence, onPiperAudio } = await import('../../lib/piperStream');
    const { splitSentences } = await import('../../lib/sentenceSplitter');

    const historyStr = history.length
      ? history.map((h: any) => `${h.role === 'user' ? 'Student' : 'You'}: ${h.content}`).join('\n')
      : '(No previous turns)';
    const userPrompt = DICE_CONTINUE_PROMPT
      .replace('{structure}', structureLabel)
      .replace('{hint}', hint)
      .replace('{question}', question)
      .replace('{history}', historyStr)
      .replace('{text}', text);
    const suggestionsPrompt = `Target grammar structure: ${structureLabel} (${hint}).\nQuestion: "${question}"\nWrite 2 short example answers that correctly use ${structureLabel}.`;

    const encoder = new TextEncoder();
    let streamClosed = false;
    const t0 = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        let removeListener: (() => void) | null = null;
        let closeTimer: ReturnType<typeof setTimeout> | null = null;
        let lastAudioAt = Date.now();
        let lastWriteAt = Date.now();
        let gotAudio = false;
        let sentencesWritten = 0;
        let audioChunksSent = 0;

        const send = (obj: object) => {
          if (streamClosed) return;
          try {
            controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
          } catch {
            streamClosed = true;
          }
        };

        const onData = (chunk: Buffer) => {
          if (streamClosed) return;
          gotAudio = true;
          lastAudioAt = Date.now();
          audioChunksSent++;
          send({ audio: chunk.toString('base64') });
        };

        const cleanup = () => {
          if (closeTimer) clearTimeout(closeTimer);
          if (removeListener) removeListener();
        };

        const waitForDrain = (): Promise<void> => new Promise((resolve) => {
          const check = () => {
            const sinceAudio = Date.now() - lastAudioAt;
            const sinceWrite = Date.now() - lastWriteAt;
            if (gotAudio) {
              const allSpoken = audioChunksSent >= sentencesWritten;
              if ((sinceAudio > DRAIN_SILENCE_MS && allSpoken) || sinceAudio > MAX_DRAIN_MS) resolve();
              else closeTimer = setTimeout(check, 200);
            } else if (sinceWrite > NO_AUDIO_TIMEOUT_MS) resolve();
            else closeTimer = setTimeout(check, 200);
          };
          check();
        });

        try {
          await ensureStarted();
          await ensurePiperStarted();
          if (isPiperRunning()) removeListener = onPiperAudio(onData);

          let sentenceBuffer = '';
          const queueSentences = (buf: string) => {
            const { sentences, remainder } = splitSentences(buf);
            for (const sentence of sentences) {
              writeSentence(sentence);
              sentencesWritten++;
              lastWriteAt = Date.now();
            }
            return remainder;
          };

          let reply = '';
          if (isRunning()) {
            for await (const chunk of completeStream(userPrompt, DICE_CONTINUE_SYSTEM_PROMPT, {
              n_predict: 90,
              temperature: 0.7,
            })) {
              if (streamClosed) break;
              send({ chunk });
              reply += chunk;
              sentenceBuffer = queueSentences(sentenceBuffer + chunk);
            }
          }

          if (!reply.trim()) {
            reply = FALLBACK_REPLY;
            send({ chunk: FALLBACK_REPLY });
            sentenceBuffer = queueSentences(sentenceBuffer + FALLBACK_REPLY);
          }
          if (sentenceBuffer.trim()) {
            writeSentence(sentenceBuffer.trim());
            sentencesWritten++;
            lastWriteAt = Date.now();
          }

          let suggestions: string[] = [];
          if (isRunning()) {
            const raw = await complete(suggestionsPrompt, DICE_SUGGESTIONS_SYSTEM_PROMPT, {
              n_predict: 96,
              temperature: 0.7,
              timeoutMs: 45000,
            });
            suggestions = parseSuggestions(raw);
          }
          if (suggestions.length === 0 && structure) suggestions = pickFallbackAnswers(structure, 2);
          send({ suggestions });
          for (const suggestion of suggestions) {
            writeSentence(suggestion);
            sentencesWritten++;
            lastWriteAt = Date.now();
          }

          await waitForDrain();
          send({ done: true });
        } catch (error) {
          console.error('Dice-continue stream error:', error);
          send({ error: error instanceof Error ? error.message : 'Stream error' });
        } finally {
          cleanup();
          streamClosed = true;
          try { controller.close(); } catch {}
          addLog(`Dice-continue: ${sentencesWritten} sentences, ${audioChunksSent} audio chunks in ${Date.now() - t0}ms`);
        }
      },
      cancel() {
        streamClosed = true;
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Dice-continue error:', error);
    return new Response(JSON.stringify({ error: 'Failed to continue conversation' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
