import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join, basename } from 'path';
import { CONVERSATION_SYSTEM_PROMPT as SYSTEM_PROMPT } from './prompts';
import { WHISPER_CLI, WHISPER_BIN_DIR, WHISPER_MODEL, findLlamaCli, getLlamaBinDir, getGemmaModelPath } from './modelConfig';

const TEMP_DIR = join(process.cwd(), 'temp');

const FALLBACK_RESPONSES = [
  "That's great! Can you tell me more about that?",
  "I hear you! Let's practice another sentence together.",
  "Good job! Keep practicing your English speaking skills.",
  "Interesting point! How would you say that in a different way?",
  "Excellent! You're making great progress with your English."
];

export function checkModels() {
  return {
    whisper: existsSync(WHISPER_MODEL),
    gemma: existsSync(getGemmaModelPath()),
    whisperCli: existsSync(WHISPER_CLI),
    llamaCli: existsSync(findLlamaCli()),
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
  const modelPath = WHISPER_MODEL;
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

  const MAX_CHARS = 320;
  const truncate = (text: string) => text.length > MAX_CHARS ? text.substring(0, MAX_CHARS - 3) + '...' : text;

  try {
    // Try llama-server first (persistent, keeps model in RAM)
    const { ensureStarted, isRunning, complete } = await import('./llamaServer');
    await ensureStarted();
    if (isRunning()) {
      const result = await complete(prompt, SYSTEM_PROMPT, { n_predict: 70, temperature: 0.7 });
      if (result) return truncate(result);
    }

    // Fallback to llama-cli.exe
    if (!status.llamaCli) {
      return 'llama-cli.exe not found. Download from https://github.com/ggerganov/llama.cpp/releases';
    }

    const { execFileSync } = await import('child_process');
    const llamaBinDir = getLlamaBinDir();
    const ts = Date.now();
    const outFile = join(TEMP_DIR, `output-${ts}.txt`);

    execFileSync(findLlamaCli(), [
      '-m', modelPath,
      '-sys', SYSTEM_PROMPT,
      '-p', prompt,
      '-o', outFile,
      '-n', '70',
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

    return truncate(response);

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Gemma inference error:', msg);
    return `Gemma error: ${msg}`;
  }
}

// Streaming version: yields response text chunks as they are generated.
// Falls back to generateResponse() when llama-server is unavailable.
export async function* generateResponseStream(
  prompt: string
): AsyncGenerator<string, void, unknown> {
  const status = checkModels();

  if (!status.gemma) {
    yield FALLBACK_RESPONSES[Math.floor(Math.random() * FALLBACK_RESPONSES.length)];
    return;
  }

  try {
    const { ensureStarted, isRunning, completeStream } = await import('./llamaServer');
    await ensureStarted();
    if (isRunning()) {
      let hadChunks = false;
      for await (const chunk of completeStream(prompt, SYSTEM_PROMPT, {
        n_predict: 70,
        temperature: 0.7,
      })) {
        hadChunks = true;
        yield chunk;
      }
      if (hadChunks) return;
    }

    // Fallback: non-streaming path
    const full = await generateResponse(prompt);
    yield full;
  } catch (error) {
    console.error('Gemma stream error:', error);
    yield `Gemma error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}


