# Confero — project brief for Claude Code

Read this first when resuming work. It's the source of truth for what this project
is, how to run it, and where we left off. (Chat history and machine-local memory do
NOT transfer between computers — this file is how work resumes cleanly.)

## What Confero is
A commercial, real-time AI meeting / interview co-pilot. A stealth desktop overlay
(only the user sees it; excluded from screen-share via `setContentProtection`) that:
live-transcribes a call, detects questions, and shows the user what to say/type.

- **Desktop app:** Electron + Node (main/renderer/preload), vanilla JS renderer.
- **Backend:** Express server (`server/`) that holds all API keys and proxies STT +
  chat. The app never sees a key. Auth = email/JWT.
- **STT:** Groq Whisper (`whisper-large-v3` primary, auto-fallback to
  `whisper-large-v3-turbo`).
- **Chat:** provider-agnostic quality chain (Gemini/Groq/Qwen/Mistral/Cohere/
  GPT-4o-mini/Qwen3-Coder…), per-provider failover, strict model picker for testing.

## Run it (two processes)
Prereqs on a fresh machine: **Node.js 18+**, then from the project root:
```
npm install                 # installs app deps (also cd server && npm install)
cd server && npm install    # backend deps
```
1. **Backend:** from `server/`: `node src/index.js`  (listens on :8787)
   - Requires `server/.env` (NOT in git — copy it over manually; keys live here).
2. **App:** from project root: `npx electron .`
   - Add `--remote-debugging-port=9222` to drive it via CDP for automated testing.

Windows/PowerShell gotchas: write `.env`/JSON as UTF-8 **no BOM** (a BOM broke
JSON.parse and wiped user data twice — use `[System.IO.File]::WriteAllText(path,
content, (New-Object System.Text.UTF8Encoding($false)))`). Kill backend by port:
`Get-NetTCPConnection -LocalPort 8787`. Electron has a single-instance lock — kill
all `electron` processes before relaunching with the debug port.

## Architecture map
- `src/main/main.js` — pipeline: transcript → question settle-window → answer.
- `src/main/modes/modes.js` (local fallback) + `server/src/modes.js` (source of
  truth, served at `/api/modes`) — data-driven mode personas. A mode can set
  `answerFormat:'code'` and `preferredProvider` (soft default).
- `src/main/llm/promptBuilder.js` — `buildAnswerPrompt` (spoken LABEL:/SAY: bullets),
  `buildCodeAnswerPrompt` (DSA scratchpad + code), `getSystemPrompt`.
- `src/main/transcription/vocabularyBank.js` — ~40-domain keyword bank that
  auto-detects the interview domain and biases Whisper (fixes "RAG"→"React" etc.).
- `src/main/state/qaLog.js` — QA telemetry JSONL at `%APPDATA%/confero/confero-qa.jsonl`
  (session_start / transcript / question_fired / answer_request / answer_received with
  per-provider attempts trace). Gate off with env `CONFERO_QA_LOG=0`.
- `server/src/ai/chat.js` — provider registry, `QUALITY_ORDER`, strict `forceProvider`
  + soft `preferProvider`, code-fence-aware sanitizer skip.
- `src/renderer/{index.html,styles.css,renderer.js,settingsPanel.js}` — overlay UI,
  themes (`data-theme` on <html>: default + matrix), code-answer rendering.

## Modes
tutoring · interview (mock) · professional · **dsa** (DSA & System Design — code
output, Qwen3-Coder preferred) · general.

## Current status (update this as you go)
Done + verified: QA telemetry log; Whisper prompt-echo bug fixed; vocabulary bank
(~40 domains); strict model picker; answer-stage layout (fixed-tall, width-resize,
pinned controls + follow-up, Clear button); themes (Default + Matrix, light-blue was
removed); original logo mark; DSA & System Design mode (persona + code rendering +
Copy button + Qwen3-Coder soft default with fallback).

Next up / open:
1. Per-mode prompt editing — store `modeInstructions[modeId]` in user settings,
   append in `getSystemPrompt`, add a small settings field targeting the active mode.
2. Screen-OCR for DSA (read the problem off-screen; currently audio-only).
3. Declutter the idle window; app-hang check via the QA log.
4. Auto/manual/stealth toggles with explainer popups.
5. Profile email-change via OTP to recovery email, retaining paid session (needs SMTP;
   currently console-fallback only).

## Rules of engagement (user preferences)
- Never rebuild a release/APK without asking first.
- Verify UI visually (screenshot/inspect) before claiming it's done — don't assert
  from memory.
- Handle all API keys only via the gitignored `server/.env`; never print secrets.
- Stop the app before hand-editing `user-settings.json`; write no-BOM.
