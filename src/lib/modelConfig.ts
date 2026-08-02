import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, dirname, isAbsolute, resolve } from 'path';

const ENV_FILE = join(process.cwd(), 'models.env');

function parseEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) out[key] = value;
  }
  return out;
}

let envCache: Record<string, string> | null = null;

function modelEnv(): Record<string, string> {
  if (!envCache) {
    // Las variables de entorno reales tienen prioridad sobre el archivo.
    envCache = { ...parseEnvFile(ENV_FILE), ...process.env };
  }
  return envCache;
}

function resolvePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (isAbsolute(value)) return value;
  return resolve(process.cwd(), value);
}

function modelsDir(): string {
  return resolvePath(modelEnv().MODELS_DIR) ?? join(process.cwd(), 'src', 'models');
}

// Piper TTS
export const PIPER_EXE =
  resolvePath(modelEnv().PIPER_EXE) ?? join(process.cwd(), 'piper', 'dist', 'piper', 'piper.exe');
export const PIPER_VOICE_MODEL =
  resolvePath(modelEnv().PIPER_VOICE_MODEL) ?? join(modelsDir(), 'en_US-lessac-medium.onnx');

// Whisper (STT)
export const WHISPER_CLI =
  resolvePath(modelEnv().WHISPER_CLI) ?? join(modelsDir(), 'whisper-bin-x64', 'whisper-cli.exe');
export const WHISPER_BIN_DIR = dirname(WHISPER_CLI);
export const WHISPER_MODEL =
  resolvePath(modelEnv().WHISPER_MODEL) ?? join(modelsDir(), 'ggml-tiny.en', 'ggml-tiny.en.bin');

// llama-server (LLM persistente)
export const LLAMA_SERVER_EXE =
  resolvePath(modelEnv().LLAMA_SERVER_EXE) ??
  join(modelsDir(), 'llama-b10182-bin-win-cpu-x64', 'llama-server.exe');
export const LLAMA_SERVER_BIN_DIR = dirname(LLAMA_SERVER_EXE);

const LLAMA_BIN_DIRS = [
  join(modelsDir(), 'llama-b10182-bin-win-cpu-x64'),
  join(modelsDir(), 'llama-b10182'),
];

export function findLlamaCli(): string {
  const fromEnv = modelEnv().LLAMA_CLI;
  if (fromEnv) {
    // Un nombre de archivo desnudo se deja para el PATH del sistema;
    // si incluye separadores de ruta se resuelve contra la raíz del proyecto.
    if (/[\\/]/.test(fromEnv)) return resolvePath(fromEnv)!;
    return fromEnv;
  }
  for (const dir of LLAMA_BIN_DIRS) {
    const candidate = join(dir, 'llama-cli.exe');
    if (existsSync(candidate)) return candidate;
  }
  return 'llama-cli.exe';
}

export function getLlamaBinDir(): string {
  const found = findLlamaCli();
  if (found !== 'llama-cli.exe') return dirname(found);
  for (const dir of LLAMA_BIN_DIRS) {
    if (existsSync(join(dir, 'llama-cli.exe'))) return dir;
  }
  return LLAMA_BIN_DIRS[0];
}

export function getGemmaModelPath(): string {
  const fromEnv = resolvePath(modelEnv().GEMMA_MODEL);
  if (fromEnv) return fromEnv;
  const dir = modelsDir();
  const candidates = [
    join(dir, 'llama-b10182', 'gemma-2-2b-it-q4_k_m.gguf'),
    join(dir, 'llama-b10182', '2b_it_v1p1.gguf'),
    join(dir, 'llama-b10182', 'gemma-1.1-2b-it-cpu-int4.gguf'),
    join(dir, 'gemma-1.1-2b-it-cpu-int4', 'gemma-1.1-2b-it-cpu-int4.gguf'),
    join(dir, 'gemma-1.1-2b-it-cpu-int4', 'gemma-1.1-2b-it-cpu-int4.bin'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  const llmDir = join(dir, 'llama-b10182');
  if (existsSync(llmDir)) {
    const files = readdirSync(llmDir).filter(f => f.endsWith('.gguf'));
    if (files.length > 0) return join(llmDir, files[0]);
  }
  return candidates[0];
}
