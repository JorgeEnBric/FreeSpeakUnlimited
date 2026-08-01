import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { CONVERSATION_SYSTEM_PROMPT, CORRECTIONS_SYSTEM_PROMPT } from './prompts';

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
let warmupState: 'idle' | 'running' | 'done' = 'idle';
let warmupPromise: Promise<void> | null = null;

export function isRunning(): boolean {
  return serverProcess !== null && !serverProcess.killed && serverProcess.exitCode === null;
}

export function getWarmupState(): 'idle' | 'running' | 'done' {
  return warmupState;
}

async function waitForServer(timeoutMs = 45000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

export function ensureStarted(): Promise<void> {
  if (isRunning()) return Promise.resolve();
  if (starting && startPromise) return startPromise;

  starting = true;
  startPromise = new Promise(async (resolve) => {
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

    serverProcess.on('error', () => { serverProcess = null; });
    serverProcess.on('exit', () => { serverProcess = null; starting = false; startPromise = null; });

    const ready = await waitForServer(45000);
    if (!ready) { serverProcess = null; }
    starting = false;
    resolve();
  });

  return startPromise;
}

export function stop(): void {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  starting = false;
  startPromise = null;
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

export async function* completeStream(
  prompt: string,
  systemPrompt: string,
  options?: { n_predict?: number; temperature?: number; repeat_penalty?: number }
): AsyncGenerator<string, void, unknown> {
  if (!isRunning()) return;

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
      stream: true,
    }),
  });
  if (!res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;

        try {
          const json = JSON.parse(payload) as {
            choices?: { delta?: { content?: string } }[];
          };
          const content = json.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch {
          // ignore malformed chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function primeCache(systemPrompt: string): Promise<void> {
  try {
    await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: 'Hello' },
        ],
        max_tokens: 1,
        temperature: 0.3,
        cache_prompt: true,
      }),
    });
  } catch {
    // warmup is best-effort
  }
}

export async function warmup(): Promise<void> {
  if (warmupState === 'done') return;
  if (warmupPromise) return warmupPromise;

  warmupState = 'running';
  warmupPromise = (async () => {
    try {
      await ensureStarted();
      if (isRunning()) {
        await primeCache(CONVERSATION_SYSTEM_PROMPT);
        await primeCache(CORRECTIONS_SYSTEM_PROMPT);
      }
    } finally {
      warmupState = 'done';
    }
  })();

  await warmupPromise;
}
