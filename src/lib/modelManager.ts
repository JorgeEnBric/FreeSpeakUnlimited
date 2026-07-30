import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join, basename } from 'path';

const MODELS_DIR = join(process.cwd(), 'src', 'models');
const WHISPER_BIN_DIR = join(MODELS_DIR, 'whisper-bin-x64');
const WHISPER_CLI = join(WHISPER_BIN_DIR, 'whisper-cli.exe');
const LLAMA_BIN_DIRS = [
  join(MODELS_DIR, 'llama-b10182-bin-win-cpu-x64'),
  join(MODELS_DIR, 'llama-b10182'),
];
function findLlamaCli(): string {
  for (const dir of LLAMA_BIN_DIRS) {
    const candidate = join(dir, 'llama-cli.exe');
    if (existsSync(candidate)) return candidate;
  }
  // Try PATH as last resort
  return 'llama-cli.exe';
}
const LLAMA_CLI = findLlamaCli();
function getLlamaBinDir(): string {
  for (const dir of LLAMA_BIN_DIRS) {
    if (existsSync(join(dir, 'llama-cli.exe'))) return dir;
  }
  return LLAMA_BIN_DIRS[0];
}
const TEMP_DIR = join(process.cwd(), 'temp');

const GEMMA_MODEL = 'gemma-1.1-2b-it-cpu-int4';

function getGemmaModelPath(): string {
  const candidates = [
    join(MODELS_DIR, 'llama-b10182', 'gemma-2-2b-it-q4_k_m.gguf'),
    join(MODELS_DIR, 'llama-b10182', '2b_it_v1p1.gguf'),
    join(MODELS_DIR, 'llama-b10182', 'gemma-1.1-2b-it-cpu-int4.gguf'),
    join(MODELS_DIR, GEMMA_MODEL, `${GEMMA_MODEL}.gguf`),
    join(MODELS_DIR, GEMMA_MODEL, `${GEMMA_MODEL}.bin`),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  const dir = join(MODELS_DIR, 'llama-b10182');
  if (existsSync(dir)) {
    const files = require('fs').readdirSync(dir).filter(f => f.endsWith('.gguf'));
    if (files.length > 0) return join(dir, files[0]);
  }
  return candidates[0];
}

const SYSTEM_PROMPT = `You are an English teacher having a conversation with a student for speaking practice.

ROLE:
- Respond naturally in English
- Be encouraging and patient
- Use everyday vocabulary
- Keep responses conversational and helpful

RESPONSE GUIDELINES:
- Be concise and to the point (max 2-3 sentences)
- Focus on practical English usage
- Use vocabulary suitable for intermediate learners
- Do NOT use emojis or emoticons

CORRECTION GUIDELINES:
- If the student made grammar or vocabulary mistakes, gently correct them
- Show the correct version in double quotes like "this is the correct way"
- Always be positive and encouraging after a correction
- If there are no mistakes, just respond naturally`;

const FALLBACK_RESPONSES = [
  "That's great! Can you tell me more about that?",
  "I hear you! Let's practice another sentence together.",
  "Good job! Keep practicing your English speaking skills.",
  "Interesting point! How would you say that in a different way?",
  "Excellent! You're making great progress with your English."
];

export function checkModels() {
  return {
    whisper: existsSync(join(MODELS_DIR, 'ggml-tiny.en', 'ggml-tiny.en.bin')),
    gemma: existsSync(getGemmaModelPath()),
    whisperCli: existsSync(WHISPER_CLI),
    llamaCli: existsSync(LLAMA_CLI),
  };
}

async function runWhisper(audioPath: string, modelPath: string): Promise<string> {
  const { execFile, execFileSync } = await import('child_process');
  const ffmpegPath = (await import('ffmpeg-static')).default;
  const wavPath = audioPath.replace('.webm', '.wav');
  const txtPath = join(TEMP_DIR, `${basename(wavPath, '.wav')}.txt`);

  if (!ffmpegPath) {
    throw new Error('ffmpeg-static binary not found');
  }

  // Convert webm to 16kHz mono wav with bundled ffmpeg
  await new Promise<void>((resolve, reject) => {
    execFile(ffmpegPath, [
      '-y', '-i', audioPath,
      '-ar', '16000', '-ac', '1', '-sample_fmt', 's16',
      wavPath
    ], { timeout: 30000 }, (err) => {
      if (err) reject(new Error(`ffmpeg conversion failed: ${err.message}`));
      else resolve();
    });
  });

  // Run whisper-cli synchronously
  execFileSync(WHISPER_CLI, [
    '-m', modelPath,
    '-f', wavPath,
    '-otxt',
    '-of', join(TEMP_DIR, basename(wavPath, '.wav')),
  ], { timeout: 120000, cwd: WHISPER_BIN_DIR, stdio: 'pipe' });

  // Read result
  let text = '';
  if (existsSync(txtPath)) {
    text = readFileSync(txtPath, 'utf8').trim();
  }

  // Cleanup
  try { unlinkSync(wavPath); } catch (_) {}
  try { unlinkSync(txtPath); } catch (_) {}

  return text || mockTranscribe();
}

function mockTranscribe(): string {
  return "Hello, I am practicing my English speaking skills.";
}

export async function transcribeAudio(audioPath: string): Promise<string> {
  const modelPath = join(MODELS_DIR, 'ggml-tiny.en', 'ggml-tiny.en.bin');
  const status = checkModels();

  if (!status.whisper) {
    throw new Error('Whisper model not found at ' + modelPath);
  }
  if (!status.whisperCli) {
    throw new Error('whisper-cli.exe not found at ' + WHISPER_CLI);
  }

  const text = await runWhisper(audioPath, modelPath);
  return text || mockTranscribe();
}

export async function generateResponse(prompt: string): Promise<string> {
  const modelPath = getGemmaModelPath();
  const status = checkModels();

  if (!status.gemma) {
    return FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
  }
  if (!status.llamaCli) {
    return 'llama-cli.exe not found. Download from https://github.com/ggerganov/llama.cpp/releases';
  }

  try {
    const { execFileSync } = await import('child_process');
    const llamaBinDir = getLlamaBinDir();
    const ts = Date.now();
    const outFile = join(TEMP_DIR, `output-${ts}.txt`);

    execFileSync(LLAMA_CLI, [
      '-m', modelPath,
      '-sys', SYSTEM_PROMPT,
      '-p', prompt,
      '-o', outFile,
      '-n', '80',
      '--temp', '0.7',
      '--repeat-penalty', '1.0',
      '--single-turn',
      '--simple-io',
    ], {
      timeout: 120000,
      cwd: llamaBinDir,
      env: { ...process.env, PATH: `${llamaBinDir};${process.env.PATH}` },
      stdio: 'pipe',
    });

    let response = '';
    if (existsSync(outFile)) {
      response = readFileSync(outFile, 'utf8').trim();
    }
    try { unlinkSync(outFile); } catch (_) {}

    // Extract content after "Assistant:" (conversation mode format)
    const asstIdx = response.lastIndexOf('Assistant:');
    if (asstIdx !== -1) {
      response = response.substring(asstIdx + 'Assistant:'.length).trim();
    }

    if (!response) {
      response = FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
    }

    const MAX_CHARS = 320;
    return response.length > MAX_CHARS
      ? response.substring(0, MAX_CHARS - 3) + '...'
      : response;

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Gemma inference error:', msg);
    return `Gemma error: ${msg}`;
  }
}

export async function processAudio(audioPath: string): Promise<{ transcription: string; response: string; correction: string }> {
  const transcription = await transcribeAudio(audioPath);
  const response = await generateResponse(transcription);

  // Extract correction: find quoted text near correction keywords
  let reply = response;
  let correction = '';
  const corrPatterns = [
    /try saying\s+"([^"]+)"/i,
    /you mean\s+"([^"]+)"/i,
    /a better way\s+(?:to say that is|to phrase that is)\s+"([^"]+)"/i,
    /"([^"]+)"\s+instead/i,
    /instead\s+of\s+"([^"]+)"/i,
    /say\s+"([^"]+)"/i,
  ];
  for (const p of corrPatterns) {
    const m = response.match(p);
    if (m) { correction = m[1]; break; }
  }
  // Fallback: first double-quoted text
  if (!correction) {
    const m = response.match(/"([^"]+)"/);
    if (m) correction = m[1];
  }

  const MAX_CHARS = 320;
  return {
    transcription,
    response: reply.length > MAX_CHARS ? reply.substring(0, MAX_CHARS - 3) + '...' : reply,
    correction: correction.length > MAX_CHARS ? correction.substring(0, MAX_CHARS - 3) + '...' : correction,
  };
}
