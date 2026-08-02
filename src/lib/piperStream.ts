import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { existsSync } from 'fs';
import { PIPER_EXE, PIPER_VOICE_MODEL } from './modelConfig';

let piper: ChildProcessWithoutNullStreams | null = null;
let starting = false;
let startPromise: Promise<void> | null = null;

export function isPiperRunning(): boolean {
  return piper !== null && !piper.killed && piper.exitCode === null;
}

export function ensurePiperStarted(): Promise<void> {
  if (isPiperRunning()) return Promise.resolve();
  if (starting && startPromise) return startPromise;

  starting = true;
  startPromise = new Promise<void>((resolve) => {
    if (!existsSync(PIPER_EXE) || !existsSync(PIPER_VOICE_MODEL)) {
      starting = false;
      startPromise = null;
      resolve();
      return;
    }

    piper = spawn(PIPER_EXE, [
      '-m', PIPER_VOICE_MODEL,
      '--json-input',
      '--output_raw',
      '--quiet',
    ], { stdio: 'pipe' });

    piper.on('error', () => {
      piper = null;
    });
    piper.on('exit', () => {
      piper = null;
      starting = false;
      startPromise = null;
    });
    piper.stderr.on('data', () => {});

    starting = false;
    resolve();
  });

  return startPromise;
}

export function writeSentence(text: string): void {
  if (!isPiperRunning() || !piper) return;
  piper.stdin.write(JSON.stringify({ text }) + '\n');
}

export function onPiperAudio(cb: (chunk: Buffer) => void): () => void {
  if (!isPiperRunning() || !piper) return () => {};
  const handler = (chunk: Buffer) => cb(chunk);
  piper.stdout.on('data', handler);
  return () => {
    if (piper && !piper.killed) {
      piper.stdout.removeListener('data', handler);
    }
  };
}

export function stopPiper(): void {
  if (piper && !piper.killed) {
    piper.kill('SIGTERM');
    piper = null;
  }
  starting = false;
  startPromise = null;
}
