# companion/README.md — Sofia Companion

Local daemon that gives Sofia hands and senses on your PC. Binds **127.0.0.1 only**;
every socket must pair with the printed token before any action runs.

## Run

```
npm install --prefix companion     # or: npm run setup (from repo root)
node companion/server.mjs          # prints ws:// URL + pairing code
```

Paste the pairing code into the web app (Settings → Companion) or set
`SOPHIA_COMPANION_TOKEN` for autostart.

## Backends

- **darwin** — `osascript` (+ optional `cliclick`)
- **win32** — native koffi backend (`win32.mjs`): one persistent helper, zero
  per-call spawns; PowerShell legacy fallback when koffi is absent
- **linux** — `xdotool`, `amixer`, `notify-send`, screenshot via gnome-screenshot/scrot

Nothing is ever assembled into a shell string; everything is `execFile` arg arrays.

## win32 native backend (Phase 17)

Same action names, no per-call cost: mouse move/click/scroll/drag, unicode
`SendInput` typing (braces/emoji verbatim, no SendKeys escaping), hotkeys
(incl. `win+` combos), cursor, DPI-aware virtual-screen metrics, BitBlt
screenshots (`.bmp`), window enumeration + focus. Legacy path keeps
PowerShell for `notify` toasts and `get/set_volume` (CoreAudio COM).

- Native results carry `via: 'native'`.
- Kill-switch: `SOPHIA_WIN32_NATIVE=0` forces the legacy path.
- Latency probe: `npm run bench --prefix companion` (win32 only;
  `--intrusive` also clicks/types after a 5s countdown). Budget: p95 < 50ms.
- Window enumeration: `active_window` with `{ list: true }`.

## Browser control (DOM-level, recommended for web tasks)

`browser_navigate`, `browser_open_read`, `browser_click_text`, `browser_type` use
Chrome DevTools Protocol via `playwright-core` (attach to your Chrome on
`SOPHIA_CDP_PORT`, default 9222, or launch `SOPHIA_CHROME_PATH`). DOM-level beats
pixel clicks whenever the task is in a browser.

## Daily skills

- **Files** — `files_roots`, `files_list`, `files_find`, `files_read`, `files_open`, `files_move`, `files_trash`, `files_restore`.
  Sandboxed to Desktop/Documents/Downloads/Pictures (or `SOPHIA_FILES_ROOTS`). Trash is recoverable; destructive ops always confirm.
- **System health** — `health_snapshot`, `health_processes`: CPU/RAM/disk/battery/uptime, top processes, warnings, 0–100 score.
- **Media** — `media_control` (play_pause/next/previous/stop/volume/mute/set_volume), `media_status`.
- **Store** — `store_get/put/keys/delete`: durable key/value (SQLite via `node:sqlite`, JSON fallback) in the OS data dir. Sophia persists Memory & Soul here.
- **Episodes** — `episodes_add/search/recent`: searchable episodic memory (FTS5 full-text, bm25 ranking; JSON-lines fallback).
- **Grounding** — `ground_text` (OCR → pixel coordinates of on-screen text) and `ground_ocr` (raw word boxes). Needs `tesseract` (`apt install tesseract-ocr` / `brew install tesseract` / `choco install tesseract`).
- **Voice (airplane mode)** — `voice_info` (which engines are present), `tts_local {text}` (→ WAV), `stt_local {data}` (base64 16-bit WAV → text). TTS engines: Piper → macOS `say` → Windows SAPI → espeak-ng; STT: whisper.cpp (`whisper-cli`) or `SOPHIA_STT_URL`. Missing binaries return an install hint, never a crash.

## Safety

- Binds **127.0.0.1 only**; every socket must pair with the printed token first.
- **Origin allowlist**: `localhost`, `127.0.0.1`, `*.grok.me`, `*.e2b.app` + `SOPHIA_COMPANION_ORIGINS=my.host,other.host`.
- **Confirmation tier**: the risk classifier (word-boundary arg scan + daemon-read OCR/UIA text under click/hotkey targets) and `files_trash`/`whatsapp_send` return `confirmation_required` with a one-time `confirmation_id`. ONLY the UI/voice-confirm handler redeems it (`{"type":"confirm","confirmation_id":"…"}` → `confirmed`), then the action is retried once with the id. Model-supplied `confirm:true` is ignored.
- **Kill switch**: `Ctrl+C`, the `abort` action, or move the mouse to the **top-left corner**. `resume` clears it.
- **Step budget**: 40 mutating actions per task (`SOPHIA_COMPANION_STEP_BUDGET`).
- **Allowlists**: `open_app` only launches named apps; `open_url` only http(s).
- Every action is appended to `actions.log.jsonl`.

## Env

| Var | Default | Purpose |
|---|---|---|
| `SOPHIA_COMPANION_PORT` | `7788` | Listen port |
| `SOPHIA_COMPANION_TOKEN` | random | Fixed pairing code (for autostart) |
| `SOPHIA_COMPANION_ORIGINS` | – | Extra allowed UI hostnames |
| `SOPHIA_COMPANION_STEP_BUDGET` | `40` | Max mutating actions per task |
| `SOPHIA_DATA_DIR` | `~/.sophia` | SQLite / logs / trash |
| `SOPHIA_FILES_ROOTS` | Desktop/Documents/Downloads/Pictures | Comma-separated sandbox roots |
| `SOPHIA_TTS_ENGINE` | auto | Force a TTS engine: `piper` \| `say` \| `sapi` \| `espeak` |
| `SOPHIA_PIPER_MODEL` | `~/.sophia/piper-voice.onnx` | Piper voice model path |
| `SOPHIA_WHISPER_MODEL` | `~/.sophia/ggml-base.en.bin` | whisper.cpp GGML model path |
| `SOPHIA_STT_URL` | – | OpenAI-compatible transcription server base URL |
| `SOPHIA_CHROME_PATH` | auto-detect | Chrome binary for CDP |
| `SOPHIA_DPI_SCALE` | auto-detect | Force display scale (`2`, or `1.5,1.5`) |
| `SOPHIA_SCREEN_OFFSET` | auto-detect | Force virtual-screen origin (`-1920,0`) |
| `SOPHIA_CDP_PORT` | `9222` | CDP attach port |

## Protocol (WebSocket, JSON)

```
client → {"type":"hello","token":TOKEN}
daemon → {"type":"welcome","actions":N}
client → {"type":"action","id":7,"action":"ping","args":{}}
daemon → {"type":"result","id":7,"ok":true,"result":{...}}
                          ok:false + error + detail (+needsConfirmation)
```

Close codes: `4001` pairing timeout, `4002` origin rejected, `4003` bad token.
