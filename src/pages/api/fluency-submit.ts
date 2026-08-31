import type { APIRoute } from 'astro';
import { FLUENCY_CONTINUE_PROMPT } from '../../lib/prompts';
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
    const topic = body.topic?.trim() ?? '';
    const text = body.text?.trim() ?? '';
    const durationMs = body.durationMs ? Number(body.durationMs) : 0;
    const history = Array.isArray(body.history) ? body.history : [];

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!topic) {
      return new Response(JSON.stringify({ error: 'No debate topic provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (durationMs < 60000) {
      return new Response(JSON.stringify({ error: `Audio debe durar al menos 60 segundos. Duración: ${Math.round(durationMs / 1000)}s` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    // Límite 80s es suave solo en micrófono, se permite enviar >80s

    if (text.split(/\s+/).length < 20) {
      return new Response(JSON.stringify({ error: 'El texto es muy corto para 60 segundos de habla' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    checkModels();

    const { initDB, insertDebate } = await import('../../lib/database');
    await initDB();
    const debateId = await insertDebate(topic, text, durationMs);

    const { notifyDebateMessage } = await import('../../lib/fluencyCorrections');
    notifyDebateMessage(debateId);

    // Build debate history string without persistence (in-memory from frontend)
    const historyStr = history.length
      ? history.map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n')
      : '(No previous history)';
    const debatePrompt = FLUENCY_CONTINUE_PROMPT
      .replace('{topic}', topic)
      .replace('{history}', historyStr)
      .replace('{text}', text);

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

        // Send debateId first so frontend can set currentDebateId for corrections polling
        send({ debateId, topic, durationMs });

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
          await ensurePiperStarted();
          if (isPiperRunning()) {
            removeListener = onPiperAudio(onData);
          }

          let sentenceBuffer = '';
          // Use debatePrompt + text as combined prompt for streaming
          const fullPrompt = `${debatePrompt}\n\nUser: ${text}`;
          for await (const chunk of generateResponseStream(fullPrompt)) {
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
          console.error('Fluency-TTS stream error:', error);
          send({ error: error instanceof Error ? error.message : 'Stream error' });
        } finally {
          cleanup();
          streamClosed = true;
          try { controller.close(); } catch {}
          const modelMs = Date.now() - t0;
          console.log(`Fluency debateId ${debateId} Tiempo en modelo IA: ${Math.round(modelMs / 1000)}s`);
          console.log(`Fluency TTS: ${sentencesWritten} sentencias, ${audioChunksSent} chunks`);
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
    console.error('Fluency submit error:', error);
    return new Response(JSON.stringify({ error: 'Failed to submit fluency speech' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
