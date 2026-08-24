import type { APIRoute } from 'astro';
import { checkModels, generateResponseStream } from '../../lib/modelManager';
import { ensurePiperStarted, isPiperRunning, writeSentence, onPiperAudio } from '../../lib/piperStream';
import { splitSentences } from '../../lib/sentenceSplitter';

export const prerender = false;

const DRAIN_SILENCE_MS = 2000;
const NO_AUDIO_TIMEOUT_MS = 2500;
const MAX_DRAIN_MS = 8000;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = body.text?.trim();
    const startTime = body.startTime ? Number(body.startTime) : null;

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    checkModels();

    const { initDB, insertMessage } = await import('../../lib/database');
    await initDB();
    await insertMessage(text);

    const { analyzePendingCorrections } = await import('../../lib/corrections');
    analyzePendingCorrections().catch(console.error);

    const encoder = new TextEncoder();
    const t0 = Date.now();
    let streamClosed = false;

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
              if ((sinceAudio > DRAIN_SILENCE_MS && allSpoken) || sinceAudio > MAX_DRAIN_MS) {
                resolve();
              } else {
                closeTimer = setTimeout(check, 200);
              }
            } else if (sinceWrite > NO_AUDIO_TIMEOUT_MS) {
              resolve();
            } else {
              closeTimer = setTimeout(check, 200);
            }
          };
          check();
        });

        try {
          await ensurePiperStarted();
          if (isPiperRunning()) {
            removeListener = onPiperAudio(onData);
          }

          let sentenceBuffer = '';
          for await (const chunk of generateResponseStream(text)) {
            if (streamClosed) break;
            send({ chunk });
            sentenceBuffer += chunk;
            const { sentences, remainder } = splitSentences(sentenceBuffer);
            sentenceBuffer = remainder;
            for (const sentence of sentences) {
              writeSentence(sentence);
              sentencesWritten++;
              lastWriteAt = Date.now();
            }
          }
          const { remainder } = splitSentences(sentenceBuffer);
          if (remainder) {
            writeSentence(remainder);
            sentencesWritten++;
            lastWriteAt = Date.now();
          }

          await waitForDrain();
          send({ done: true });
        } catch (error) {
          console.error('Chat-TTS stream error:', error);
          send({ error: error instanceof Error ? error.message : 'Stream error' });
        } finally {
          cleanup();
          streamClosed = true;
          try { controller.close(); } catch { /* already closed */ }
          const modelMs = Date.now() - t0;
          console.log(`Tiempo en modelo IA: ${Math.round(modelMs / 1000)} segundos`);
          console.log(`TTS stream: ${sentencesWritten} sentencias escritas, ${audioChunksSent} chunks de audio enviados`);
          if (startTime) {
            console.log(`Tiempo total: ${Math.round((Date.now() - startTime) / 1000)} segundos`);
          }
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
    console.error('Chat-TTS error:', error);
    return new Response(JSON.stringify({ error: 'Failed to process message' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
