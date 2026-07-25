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
Copy button + Qwen3-Coder soft default with fallback); free-plan "Answer now" fix
(focus mode hid `#suggestions-pane` — the only place free answers render — so
answers painted into a `display:none` pane; `.app.focus.free` now keeps it, and
the `answer:quick` IPC event finally has a listener); **Code Assist workspace**
(DSA/LLD): "Code assist" button (shown only for `answerFormat:'code'` modes)
opens a full-panel overlay to PASTE the interviewer's on-screen problem. The
problem is anchored in `appState.activeCodingProblem` for the whole round; paste-
solve + typed follow-ups run on a dedicated IPC channel (`assist:solve-problem`
/`assist:code-followup`) OUTSIDE runAnswerPipeline's generation counter so a
concurrent SPOKEN turn can't retire them. Spoken code-mode answers mirror into
the same thread via `code:answer` when a problem is anchored. `buildCodeAnswerPrompt`
now takes `anchoredProblem` + is instruction-responsive (approach-only / dry-run /
complexity / optimize), with CODE as the strong default (a relaxed version made
weak fallback models skip code — re-hardened). Code mode is exempt from the free-
tier follow-up gate (threading is a correctness need in a coding round, not the
upsell). Multi-problem switching: once a problem is anchored, typed text is a
follow-up — to switch to the interviewer's NEXT question, a visible composer
"＋ New problem" button re-anchors + clears the thread (a long/multi-line paste
pulses it as a nudge). Header "New problem" = plain reset. Fixes the bug where a
2nd pasted problem was answered as a follow-up to the 1st (prose, wrong problem).
Closing the workspace now fully detaches the problem: `assist:clear-problem`
wipes BOTH `activeCodingProblem` AND `lastQA`, so after the candidate closes Code
Assist a spoken question on a new topic (e.g. HLD "what is system design") is
answered fresh, not against the previous DSA problem. Verified end-to-end via CDP.

**Conversation memory / speaker separation:** transcript is already speaker-tagged
(`source:'system'`=interviewer, `'mic'`=candidate); answers only saw the last 20
lines, so a project the candidate mentioned 4-5 questions ago fell out of context.
Added `candidateNotes()` in main.js — the candidate's substantive mic statements
NOT in the recent window (filler/read-backs dropped, bounded 20 items/1800 chars) —
fed to `buildAnswerPrompt`/`buildCodeAnswerPrompt` as a "What I've already told them
earlier this session" block, so an interviewer follow-up on an earlier project/tool
is grounded in what the candidate actually said. Recent-window labels renamed
[Them]→[Interviewer]. Added `isInterviewerEcho()` mic-bleed guard: on SPEAKERS the
mic re-hears the interviewer; a mic line overlapping a recent system line (≥0.6) is
dropped as bleed (gated on `sawSystemAudio` so solo practice is unaffected). For
clean attribution the candidate should use HEADPHONES. Verified via standalone test
+ real backend LLM grounding call (Kafka/Flink project recalled 20+ lines later).

**Login system / monetization (two tiers: free + premium; DSA & System Design =
premium):** MongoDB Atlas migration DONE (dual-backend `userStore`: Mongo when
`MONGODB_URI` set, else JSON file; all funcs async; `setPlan`/`updateUser` added).
Premium gating DONE — `dsa` mode carries `premium:true` (server `modes.js` + local
fallback), `/api/modes` returns the user's `plan`, the app locks the DSA mode card
(🔒 Premium badge; clicking it opens the upgrade flow, does NOT switch mode), and
`/api/suggest` HARD-rejects premium modes for free plans with 402 (app sends the
active `mode` id via `getAnswer`→`chatCompletionMeta`; 402 surfaces as a friendly
upsell). Fixed a latent bug: app checked `plan!=='pro'` but backend issues
`'premium'` — standardized to `'premium'` (premium users now actually get adaptive
follow-up threading + rephrase). Stripe billing DONE — `server/src/billing.js`
(checkout session stamps user id; webhook flips plan on `checkout.session.completed`,
downgrades on `customer.subscription.deleted`); routes `/api/billing/checkout`
(auth) + `/api/billing/webhook` (express.raw, signature-verified); degrades to a
friendly 503 until `STRIPE_SECRET_KEY`+`STRIPE_PRICE_ID` set. App: header `✦ Upgrade`
pill (free only) → `billing:start-upgrade` opens Checkout in browser + polls
`/api/me`, auto-flips to premium on payment. Post-checkout page `public/upgraded.html`.
Passwordless email OTP login DONE — `auth.requestOtp`/`verifyOtp` (6-digit, bcrypt-
hashed, 10-min TTL, 5-attempt cap, single-use, rotates session); routes
`/api/auth/otp/request`+`/verify`; `emailer.sendLoginCode` (console fallback when no
SMTP); `signin.html` "Email me a sign-in code instead" flow. Google OAuth was
already built — just needs `GOOGLE_CLIENT_ID/SECRET`. Verified: 13/13 server-logic
checks (file backend) + live HTTP (signup/otp/402-gate/503-checkout) + CDP UI
(pill visible, DSA locked, locked-click→upsell not mode-switch, applyPlan('premium')
→pill hides+DSA unlocks). Deps: `stripe` added to `server/package.json`. Render env
to set (all `sync:false`): `STRIPE_SECRET_KEY`,`STRIPE_PRICE_ID`,`STRIPE_WEBHOOK_SECRET`,
`SMTP_*` (for real OTP/reset emails), optional `GOOGLE_CLIENT_ID/SECRET`. Docs in
DISTRIBUTION.md. NOT yet committed to git.

Next up / open:
1. Per-mode prompt editing — store `modeInstructions[modeId]` in user settings,
   append in `getSystemPrompt`, add a small settings field targeting the active mode.
2. Screen-OCR for DSA — DONE. "Snip screen" button in Code Assist opens a
   full-screen, CONTENT-PROTECTED selection overlay (`windows/snipWindow.js` +
   `renderer/snipOverlay.html`); the candidate drags a rectangle, main hides the
   overlay, grabs the screen via `desktopCapturer`, crops to the region (scaled by
   `display.scaleFactor`), and POSTs the PNG to the backend `/api/extract-text`,
   which runs a vision model (Groq Llama-4 Scout `groqVisionModel`, Gemini-vision
   if keyed) and returns the text. It fills the editable paste box (never
   auto-solves — a human checks the extracted constraints). IPC: `snip:start`
   (invoke, resolves {text}|{cancelled}|{error}) + `snip:region`/`snip:cancel`
   (from the overlay). Refused under proctoring. Verified end-to-end via CDP
   (captured an on-screen problem image → exact text). LIMITATION: primary display
   only (multi-monitor is v2). Stealth = same `setContentProtection` as the main
   overlay; for a real call the user should spot-check it's invisible in the share.
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
