# FreeSpeak - English Speaking Practice

Practice speaking English with AI using speech recognition and text-to-speech free and unlimited.

## Models Setup

Place your models in the `/src/models` directory:

1. **gemma-1.1-2b-it-cpu-int4** - Language model for generating responses
2. **ggml-tiny.en** - Whisper model for speech-to-text

## Features

- Single button recording for hands-free practice
- Chat-style responses (max 80 tokens)
- Text-to-speech for listening practice
- Server Islands for dynamic content

## Development

```bash
npx astro dev
npx astro dev --force (Opcional)
```

The app will be available at https://localhost:4321

## How It Works

1. Click the microphone button to start recording
2. Speak English
3. Click again to stop recording
4. Your speech is transcribed using Whisper
5. The AI responds with text and reads it aloud
6. Practice listening and repeat the cycle
