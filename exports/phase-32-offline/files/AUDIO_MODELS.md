# Sofia local audio models (Phase 32)

How Sofia's audio agents (ears, voice loop, dictation) run **fully offline**,
and how to point them at a self-hosted model.

## The short version

| Leg | Default (offline) | Custom |
| --- | --- | --- |
| Speech → text | Companion daemon's local Whisper (`stt_local`) | Any OpenAI-compatible `/audio/transcriptions` endpoint |
| Text → speech | Companion TTS (Piper / espeak / say / SAPI) | — (companion only for now) |
| Brain | Ollama via the Sofia server, or direct-to-Ollama fallback | `ollamaUrl` / `ollamaModel` in settings |

Set the transcription engine in **Settings → Ear & Mouth → Transcription
engine**, or leave it on *Companion Whisper* for zero setup.

## About "Qwen Audio 3.1"

There is no public model by that exact name (as of Sep 2026). The closest
real Qwen audio models are:

- **Qwen2-Audio** — speech understanding (transcription, translation, voice chat).
- **Qwen3-Omni** — the current flagship: speech in/out, ~19 speech-input
  languages **including Urdu**, Apache-2.0.

Caveat: these are **Transformers/vLLM-style models, not Ollama pulls**.
`ollama pull qwen-audio` does not exist, and llama.cpp audio support is still
partial — so Sofia reaches them through the **custom endpoint** path below,
not through Ollama.

## Recipe 1: faster-whisper-server (recommended, light)

The simplest OpenAI-compatible local STT. On the machine with the GPU/CPU
to spare:

```bash
pip install faster-whisper-server
python -m faster_whisper_server --host 127.0.0.1 --port 8000 \
  --model Systran/faster-whisper-large-v3
```

Then in Sofia: **Ear & Mouth → Transcription engine → Custom endpoint**,
base URL `http://127.0.0.1:8000/v1`, model `whisper-1`
(most local servers accept any string here). The daemon also honours
`SOPHIA_STT_URL` for the same purpose.

## Recipe 2: Qwen3-Omni via a self-hosted endpoint

Qwen3-Omni runs under Hugging Face Transformers (GPU with generous VRAM —
think 24 GB+ for comfortable inference). Serve it behind an
OpenAI-compatible `/audio/transcriptions` route (a thin FastAPI wrapper
around the `Qwen3-Omni` transformers pipeline), then point Sofia's custom
endpoint at that base URL. Pick this when you need Qwen's extra input
languages (e.g. Urdu) or its voice-interaction abilities; pick Recipe 1
for plain transcription.

## Recipe 3: whisper.cpp server (tiny devices)

```bash
./build/bin/whisper-server -m models/ggml-large-v3.bin --host 127.0.0.1 --port 8080
```

whisper.cpp's endpoint shape differs slightly from OpenAI's; prefer Recipe 1
unless you are already invested in whisper.cpp.

## How the fallback works

- **Auto run mode** (default): cloud first; after 2 consecutive cloud
  failures the whole app trips offline and the task decider + voice legs
  use the local paths above. 3 consecutive cloud successes recover.
- **Offline run mode**: the cloud is never touched, period.
- The task decider falls back to **direct-to-Ollama** (bypassing the Sofia
  server) and salvages JSON even when small local models wrap it in prose.

Error strings are actionable by design: `stt_unreachable` (server down),
`stt_http_*` (server rejected the audio), `offline_brain_unreachable`
(Ollama down — run `ollama serve`).
