import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const MODELS_DIR = join(process.cwd(), 'src', 'models');
const LLAMA_BIN_DIR = join(MODELS_DIR, 'llama-b10182-bin-win-cpu-x64');
const SERVER_EXE = join(LLAMA_BIN_DIR, 'llama-server.exe');

const HOST = '127.0.0.1';
const PORT = 8080;
const BASE_URL = `http://${HOST}:${PORT}`;

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

let serverProcess: ChildProcess | null = null;
let starting = false;
let startPromise: Promise<void> | null = null;

export function isRunning(): boolean {
  return serverProcess !== null && !serverProcess.killed;
}

export function ensureStarted(): Promise<void> {
  if (isRunning()) return Promise.resolve();
  if (startPromise) return startPromise;
  if (starting) return startPromise!;

  starting = true;
  startPromise = new Promise((resolve) => {
    const modelPath = getGemmaModelPath();
    if (!existsSync(SERVER_EXE)) {
      console.warn('[llama-server] exe not found');
      starting = false; resolve(); return;
    }
    if (!existsSync(modelPath)) {
      console.warn('[llama-server] model not found');
      starting = false; resolve(); return;
    }

    serverProcess = spawn(SERVER_EXE, [
      '-m', modelPath,
      '--host', HOST,
      '--port', String(PORT),
      '-c', '4096',
      '--parallel', '1',
    ], {
      cwd: LLAMA_BIN_DIR,
      stdio: 'pipe',
      env: { ...process.env, PATH: `${LLAMA_BIN_DIR};${process.env.PATH}` },
    });

    const onReady = (d: Buffer) => {
      const text = d.toString();
      if (text.includes('model loaded') || text.includes('listening') || text.includes('starting')) {
        starting = false;
        resolve();
      }
    };

    serverProcess.stdout?.on('data', onReady);
    serverProcess.stderr?.on('data', onReady);

    serverProcess.on('error', () => { serverProcess = null; starting = false; resolve(); });
    serverProcess.on('exit', () => { serverProcess = null; starting = false; });

    setTimeout(() => { starting = false; resolve(); }, 30000);
  });

  return startPromise;
}

export function stop(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
}

export async function complete(
  prompt: string,
  systemPrompt: string,
  options?: { n_predict?: number; temperature?: number; repeat_penalty?: number }
): Promise<string | null> {
  if (!isRunning()) return null;

  try {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: options?.n_predict ?? 1000,
        temperature: options?.temperature ?? 0.3,
        repeat_penalty: options?.repeat_penalty ?? 1.0,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json() as { choices: { message: { content: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}
