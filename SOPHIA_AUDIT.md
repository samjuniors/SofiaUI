# 🔍 Sophia OS Audit Report

_Last verified: 2026-09-28. Regenerate the "Verification" table by running the commands listed — do not hand-edit statuses._

## 1. Verification (automated)

| Check | Command | Result |
| :--- | :--- | :--- |
| Typecheck | `npm run typecheck` | ✅ 0 errors |
| Lint | `npm run lint` | ✅ 0 errors, 0 warnings |
| Unit tests | `npm test` | ✅ 259 / 259 |
| Production build | `npm run build:dev` | ✅ |
| Dependency audit | `npm audit --omit=dev` | ✅ 0 vulnerabilities |
| Secret scan | `git grep -E "(AIza\|sk-\|xai-)[A-Za-z0-9_-]{20,}"` | ✅ none committed |

## 2. Security fixes applied

| Issue | Severity | Fix |
| :--- | :--- | :--- |
| `system/action` interpolated a user URL into a shell string (`exec`) — RCE on macOS/Linux via `$(…)` | 🔴 Critical | URL normalised by `resolveBrowserTarget()` (http/https only), launched with `execFile` and no shell; Windows uses `rundll32 url.dll,FileProtocolHandler`. |
| `live/session` returned the raw `GEMINI_API_KEY` to the browser | 🔴 Critical | Mints a single-use ephemeral token via `ai.authTokens.create`. Raw-key fallback only with `SOPHIA_ALLOW_RAW_LIVE_KEY=1` (local dev). |
| Client-supplied `ollamaUrl` / `lmStudioUrl` were unrestricted server-side fetch targets (SSRF) | 🟠 High | Overrides honoured only for local-dev requests or `SOPHIA_ALLOW_LLM_URL_OVERRIDE=1`; always http(s), no credentials, link-local/metadata hosts blocked. See `sophia-server-policy.ts`. |
| Retired model IDs (`gpt-4o`, `claude-3-5-sonnet-20241022`) made the OpenAI and Claude brains fail every call | 🟠 High | Updated to `gpt-6-sol` / `claude-sonnet-4-6`; all model IDs now env-overridable (`OPENAI_MODEL`, `ANTHROPIC_MODEL`, `XAI_MODEL`, `GEMINI_TEXT_MODEL`, `GEMINI_TTS_MODEL`, `GEMINI_LIVE_MODEL`). OpenAI path uses `max_completion_tokens`. |

## 3. Known open items

| Item | Notes |
| :--- | :--- |
| **No authentication on `/api/sophia/*`** | Chat, TTS, image-gen, web-search and `system/action` are callable by any visitor. On a public deployment this is an open credit-burner and can open browser tabs on the host. Deliberately deferred; gate behind the existing better-auth session when ready. |
| Large files | `SettingsSheet.tsx` (~1.5k lines) and `SophiaOS.ts` (~1.2k lines) should be split before further feature work. |
| Two lockfiles | `bun.lock` and `package-lock.json` both present. Scripts use `npm`; pick one. |
| Test coverage | Scaffold scripts, auth helpers and server request policy are covered. Provider fallback chain and voice providers are not. |

## 4. Functional surface (manual, not re-verified this pass)

Boot sequence, voice fallback chain (Gemini Live → Deepgram → ElevenLabs), local brains (Ollama / LM Studio), wake word / clap detection, spatial audio, emotional morphs, HUD/dock UI. These were reported working in earlier passes; treat as unverified until exercised in a browser QA run.

## 5. Environment variables introduced by this audit

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `SOPHIA_ALLOW_RAW_LIVE_KEY` | unset | `1` returns the raw Gemini key from `live/session` when ephemeral tokens cannot be minted. Local dev only. |
| `SOPHIA_ALLOW_LLM_URL_OVERRIDE` | unset | `1` lets non-local clients point the server at their own Ollama / LM Studio URL. |
| `OPENAI_MODEL` | `gpt-6-sol` | OpenAI chat model. |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-6` | Claude chat model. |
| `XAI_MODEL` | `grok-4.5` | Grok chat model. |
| `GEMINI_TEXT_MODEL` | `gemini-3.8-flash` | Gemini text brain. |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-lite-tts` | Gemini TTS model. |
