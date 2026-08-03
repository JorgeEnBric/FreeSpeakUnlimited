# FreeSpeak - English Speaking Practice

Practice speaking English with AI — free, unlimited, and **100% local**. No cloud, no API keys, no subscription.

<img width="1365" height="639" alt="imagen" src="https://github.com/user-attachments/assets/f355071d-36af-48df-a745-b81a41f92c32" />

## Features

- Single-button recording for hands-free practice
- Speech-to-text (Whisper) — local
- AI chat responses (Gemma 2 2B) — local
- Text-to-speech with streaming audio (Piper) — local
- Grammar corrections for what you say
- Save useful "New Expressions" as you learn
- Pomodoro timer mode (work / break)
- All data stays on your device

## Requirements

- **Node.js >= 22.12** (LTS recommended)
- **Git**
- **models.zip** — contains all the AI models (Download models.zip from [Release] v1.0.0)

## Setup

### 1. Clone the repository

```bash
git clone https://github.com/JorgeEnBric/FreeSpeakUnlimited.git
cd FreeSpeakUnlimited
```

### 2. Install dependencies

```bash
npm install
```

### 3. Extract the models

Download models.zip from Release v1.0.0 and extract its contents into the src/ directory at the project root.

```bash
# PowerShell
Expand-Archive -Path .\models.zip -DestinationPath . -Force
# or on Linux/macOS
unzip models.zip -d .
```

Verify the layout:

```
src/models/
├── en_US-lessac-medium.onnx            # Piper TTS voice
├── en_US-lessac-medium.onnx.json
├── gemma-2-2b-it-q4_k_m/
│   └── gemma-2-2b-it-q4_k_m.gguf       # Gemma 2 2B (LLM)
├── ggml-tiny.en/
│   └── ggml-tiny.en.bin                # Whisper STT model
├── llama-b10182-bin-win-cpu-x64/
│   └── llama-server.exe, llama-cli.exe, ...   # llama.cpp
├── piper/dist/piper/
│   └── piper.exe, onnxruntime.dll, espeak-ng-data/
└── whisper-bin-x64/
    └── whisper-cli.exe, whisper.dll, ...
```

If your model paths differ, edit `models.env` in the project root (paths are relative to the project root; system environment variables take priority over the file).

### 4. Start the dev server

```bash
npm run dev
# or: npx astro dev
```

### 5. Open the app

- URL: **https://localhost:4321** (HTTPS — the app uses a self-signed SSL cert)
- Your browser will warn about the certificate: click **Advanced → Proceed**.
- Allow **microphone** access when prompted.

## How It Works

1. Click the microphone button to start recording.
2. Speak English.
3. Click again to stop recording.
4. Your speech is transcribed using Whisper.
5. The AI (Gemma 2 2B via llama.cpp) responds with text.
6. Piper reads the response aloud as it streams in.
7. Practice listening and repeat the cycle.
