import type { APIRoute } from 'astro';
import { spawn } from 'child_process';
import { join } from 'path';

export const prerender = false;

const PIPER_EXE = join(process.cwd(), 'piper', 'dist', 'piper', 'piper.exe');
const VOICE_MODEL = join(process.cwd(), 'src', 'models', 'en_US-lessac-medium.onnx');

// Scales 16-bit PCM so the peak sits at ~80% of full scale, removing clipping
function buildWav(pcm: Buffer): Buffer {
  const sampleRate = 22050;
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataSize, 40);

  let peak = 1;
  for (let i = 0; i + 1 < pcm.length; i += 2) {
    const abs = Math.abs(pcm.readInt16LE(i));
    if (abs > peak) peak = abs;
  }
  const gain = Math.min(1, (0.8 * 32768) / peak);

  const out = Buffer.alloc(44 + dataSize);
  header.copy(out, 0);
  if (gain >= 1) {
    pcm.copy(out, 44);
  } else {
    for (let i = 0; i < dataSize; i += 2) {
      const sample = pcm.readInt16LE(i);
      const scaled = Math.max(-32768, Math.min(32767, Math.round(sample * gain)));
      out.writeInt16LE(scaled, 44 + i);
    }
  }
  return out;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = body.text?.trim();

    if (!text) {
      return new Response(JSON.stringify({ error: 'No text provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const chunks: Buffer[] = [];
    const child = spawn(PIPER_EXE, [
      '--model', VOICE_MODEL,
      '--length_scale', '1.15',
      '--noise_scale', '0.5',
      '--output_raw',
    ]);

    child.stdout.on('data', (d) => chunks.push(Buffer.from(d)));
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});

    child.stdin.write(text);
    child.stdin.end();

    const pcm = await new Promise<Buffer>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Piper exited with code ${code}`));
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });

    if (!pcm.length) {
      return new Response(JSON.stringify({ error: 'No audio generated' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const cleanWav = buildWav(pcm);

    return new Response(new Uint8Array(cleanWav), {
      status: 200,
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': String(cleanWav.length),
      },
    });
  } catch (error) {
    console.error('TTS error:', error);
    return new Response(JSON.stringify({ error: 'Failed to synthesize speech' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
