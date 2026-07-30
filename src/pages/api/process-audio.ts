import type { APIRoute } from 'astro';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { processAudio, checkModels } from '../../lib/modelManager';

export const prerender = false;

const TEMP_DIR = join(process.cwd(), 'temp');

export const POST: APIRoute = async ({ request }) => {
  try {
    if (!existsSync(TEMP_DIR)) {
      await mkdir(TEMP_DIR, { recursive: true });
    }

    const formData = await request.formData();
    const audioFile = formData.get('audio') as File;

    if (!audioFile) {
      return new Response(JSON.stringify({ error: 'No audio file provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const audioPath = join(TEMP_DIR, `recording-${Date.now()}.webm`);
    await writeFile(audioPath, audioBuffer);

    const modelStatus = checkModels();
    let missing = [];
    if (!modelStatus.whisper) missing.push('Whisper model (ggml-tiny.en.bin)');
    if (!modelStatus.gemma) missing.push('Gemma model (gemma-1.1-2b-it-cpu-int4.bin)');

    if (missing.length > 0) {
      await unlink(audioPath);
      return new Response(JSON.stringify({
        error: `Missing models: ${missing.join(', ')}. Place them in /src/models/`,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    try {
      const result = await processAudio(audioPath);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (processingError) {
      const msg = processingError instanceof Error ? processingError.message : 'Unknown error';
      return new Response(JSON.stringify({ error: msg }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } finally {
      try { await unlink(audioPath); } catch (_) {}
    }

  } catch (error) {
    console.error('Error processing audio:', error);
    return new Response(JSON.stringify({ error: 'Failed to process audio' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};