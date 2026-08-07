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
tutoring · interview (mock) · professional (labelled "Live meeting") · **dsa** (DSA & System Design — code
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

**End session → transcript + summary (copyable):** an "End session" button in the
action bar (shown whenever the session has content; label shortens to "End" while
live) stops capture and opens a report modal with two tabs — **Summary** and
**Transcript** — plus Copy summary / Copy transcript / Copy both. Main-process
`session:end` IPC (`src/main/state/sessionReport.js`) builds the transcript locally
(elapsed `[mm:ss]` stamps, mode-aware speaker labels: interview→Interviewer/You,
tutoring→Student/Tutor, else Them/You) and generates the summary via
`buildSessionSummaryPrompt` — a fixed OVERVIEW / KEY POINTS / <mode-specific> /
ACTION ITEMS skeleton, where the third section varies by mode (interview→QUESTIONS
& HOW THEY WERE ANSWERED, dsa→PROBLEMS & APPROACHES, professional→DECISIONS…).
Long meetings map-reduce: >11k chars chunks into per-part notes (`task:'notes'`)
then one merge pass. Ending also ARCHIVES immediately (summary included in the
record; `appState.archivedAt` stops the next Start from double-saving, and is
cleared when new speech arrives), so a session survives closing the app. Past
sessions show the summary + their own Copy summary/transcript buttons.
**Backend change this needs:** `/api/suggest` now takes a `task` name selecting a
server-side generation profile in `server/src/ai/chat.js` (`TASK_PROFILES`, via
AsyncLocalStorage) — the live-answer defaults (300 tokens, 8s, spoken-answer
cleaners) truncated the summary after its first heading AND `stripRepetition`
flattened every newline into one paragraph. `summary` = 1100 tokens / 30s /
cleaners skipped. **Render must be redeployed** or summaries come back flattened.
Verified via CDP end-to-end against a local backend (4/4 sections, 13 bullets,
copy buttons, no duplicate archive on retry, error state + Retry) and by a direct
A/B on `/api/suggest`: task=summary → 18 newlines, 4/4 sections; no task → 0
newlines. Action bar re-laid-out (`flex-wrap` + `nowrap` labels +
`min-width:max-content` on `.active-actions`) — with six controls in DSA mode the
CTA label used to wrap and Stop overlapped End.

**Reading surface + launch flow (renderer):** answers used to append to the
bottom of `#suggestions-pane`, so the newest question was off-screen — the
candidate had to scroll DOWN mid-interview. `appendAtTop()` now pulls the
just-added card to the TOP of the pane (trailing `.feed-spacer` gives the last
card the room to get there); previous Q→A pairs sit above, one scroll up.
Card markup replaced: `.qa-card` = bold question (`.qa-q`) → answer → thin foot
(rephrase button + muted model/latency). Dropped the `Q ·`/timestamp chips and
the `"quotes"` around SAY lines. Transcript dropped the `[Them]`/`[You]` labels
for a coloured left rail (blue=interviewer, amber+muted=you); the ticker no
longer prefixes a tag. `professional` mode RELABELLED **"Live meeting"** (id
unchanged — saved modeContext/documentContext are keyed by it) in BOTH
`server/src/modes.js` and the local fallback; installed/packaged apps read the
Render backend, so that label needs a **server redeploy** to reach users.
Launch flow: new `#purposeGate` (step 1, MANDATORY — no ✕, no skip, premium
cards locked→upgrade) shown every launch after the ethics agreement, then the
existing `#sessionGate` (step 2, skippable) for personal context. Wired via
`startLaunchFlow()` (deferred with `queueMicrotask` — it awaits `modesReady`
declared later in the file). `onAnswerReady`'s handler extracted to a named
`renderAnswer()` so the real render path is drivable from CDP. Verified via CDP:
purpose gate → consent (interview only) → context gate; newest card measured at
offset 0 with all previous cards fully above the viewport; scrollback intact;
code answers + Copy buttons fine in the new card.

**"Hide from screen share" toggle (branch `togglestealth`):** stealth was
hotkey-only (Ctrl+Shift+H) and undiscoverable, so there's now an eye/eye-off
`#shareHideBtn` in the header. **Never say "stealth" in user-facing copy** — the
customers aren't technical. The vocabulary is: "Hidden from screen share" /
"Visible on screen share"; indicator pill "Hidden from share" / "Visible on
share"; toggling shows a plain-words banner, and going VISIBLE is an amber icon
+ a red banner because that's the state that costs you if you're wrong about it.
Internal names (`appState.stealthEnabled`, `stealth:*` IPC, `stealthAPI`) are
unchanged — renaming them buys nothing and touches everything.
Wiring: `applyScreenShareHidden(overlayWin, indicatorWin, enabled)` extracted in
`shortcuts/stealthShortcut.js` is now the ONE place that flips content
protection; the hotkey, the new `stealth:set` IPC and the guardrail all go
through it, so window / pill / header button can't drift. Persisted as
`hideFromScreenShare` in user-settings (default true), restored in
`startMainApp` — safe to persist precisely because the header icon and pill
always show the live state. `CONFERO_DEV_VISIBLE` still overrides. The proctoring
guardrail refuses `stealth:set(true)` and forces it off WITHOUT persisting
(forced ≠ chosen), then restores the user's own choice when the exam app closes.
**Header layout had to be fixed to fit a 7th control:** flex children had no
`min-width:0`, so the row overflowed — the mode chip wrapped to two lines and the
brand ended up under the Upgrade pill. Now `.brand` is `flex-shrink:0` (the
product name must never render as "Confe…"), the mode chip shrinks and
ellipsizes instead (`max-width:160px`), and `.header` has an explicit `gap:10px`
because `space-between` has no space left to distribute once the row is full.
Verified via CDP at 436px width: 4 clicks alternate exactly with renderer/main
in sync, no self-toggling over 40s idle, preference survives a real app restart
(`[screen-share] hidden -> OFF` on relaunch), pill text fits its 150px window.

**Summary formatting (bullets, not a paragraph):** the reported bug was the
closing summary reading as one prose blob. Root cause is model variance, not the
backend: every summary on Render is being answered by `groqChatModel` =
**`llama-3.1-8b-instant`** (config.js default; Gemini/Cerebras sit ahead of it in
`QUALITY_ORDER` but evidently have no key there), and an 8B model drops the
output format under load — reproduced a real response that came back with the
whole summary on ONE physical line, headings and "- " bullets inline. (The old
"Render must be redeployed or summaries come back flattened" note above is stale:
A/B'd `/api/suggest` against Render — both task=summary and no-task return 14-15
newlines, so the profile is live.) Fixed on both ends:
1. Prompt (`buildSessionSummaryPrompt`) now gives a literal template plus hard
   formatting rules — every line under a bullet heading MUST start with "- ",
   one idea per bullet, 8-20 words, 3-6 per section, "- None stated." for an
   empty one, OVERVIEW the only prose section and under three sentences. The
   note-taker system prompt in `sessionReport.js` repeats "never answer in prose
   paragraphs" (weak models drop the format before they drop the content).
2. Renderer REPAIRS whatever arrives, rather than trusting it —
   `normalizeSummary()` (idempotent) puts line breaks back before a CAPS heading
   and before inline bullets, then `summaryHtml()` sections it: strips markdown
   (`##`, `**bold**`, `*`/`1.` bullets), accepts Title-Case headings, and splits
   prose that landed in a bullet section into one bullet per sentence. A summary
   with no structure at all is bulleted by sentence. Normalization is applied to
   `endReport.summary` and saved sessions too, so the COPIED text is formatted,
   not just the on-screen one.
   Two traps worth remembering, both hit during this work: the heading
   alternation backtracks and cuts "ACTION ITEMS & NEXT STEPS" in half at its own
   "&" (hence the `(?![&+])` guards), and splitting on a bare " - " destroys
   prose like "the client - who joined late - agreed" (hence requiring sentence
   punctuation before an inline bullet: `(?<=[.;:!?])\s+[-•]\s+`).
Verified via CDP over 6 shapes (well-formed / collapsed-one-line / markdown /
prose-under-heading / one-paragraph / dash-in-prose): all render as headings +
bullets, all idempotent, dash-in-prose untouched; plus 3 live backend runs
(4 headings, 11-13 bullets each) and a visual check of the report modal.
**Quality lever not taken:** setting `GROQ_CHAT_MODEL=llama-3.3-70b-versatile`
(or adding a Gemini/Cerebras key) on Render would fix the cause rather than the
symptom — left alone because it also affects latency-sensitive live answers.

**Report modal copy → corner icon (+ a clipboard bug this exposed):** the footer
row ("Copy summary" CTA + "Copy both") is gone; copy is now a single `.btn-icon
.icon-copy` in the `.end-head` beside the ✕. It acts on whichever tab is open
(title tracks it: "Copy summary"/"Copy transcript"), confirms by swapping its SVG
to a green tick via a `.copied` class for 1.5s (an icon has no label to
overwrite, so `copyWithFeedback` branches on `.icon-copy`), clears the tick on
tab switch, and dims at `opacity:.3` while disabled. `#endActions` now holds only
Retry and the ROW itself is hidden unless `endReport.error` — an empty flex box
still costs a `.gate-card` gap. "Copy both" and `endBothText()` deleted.
**The bug this surfaced:** `setPermissionRequestHandler` only allowed
`['media','display-capture']`, so `navigator.clipboard.writeText` rejected with
NotAllowedError and EVERY copy button in the app silently did nothing — the
report modal, past-session copies, and Code Assist's code Copy (which swallowed
the rejection in a bare `.catch(() => {})`, so it never even said "Copied").
Fixed in main.js: `ALLOWED_PERMISSIONS` adds `clipboard-write` +
`clipboard-sanitized-write`, and a `setPermissionCheckHandler` was added — the
clipboard path asks the CHECK handler, not the request handler, so allowing it in
only one of the two is not enough. Verified with REAL trusted clicks via
`Input.dispatchMouseEvent` (a synthetic `el.click()` is not a fair test here) and
by reading the OS clipboard back with `Get-Clipboard`: summary tab → formatted
summary, transcript tab → transcript, Code Assist → the code block.

**Default theme repainted — professional graphite + light blue:** the old
purple/pink duotone (`#7c5cff` + `#ff6bd6` on a purple-tinted `#1a1626` shell)
read as consumer/childish for a tool that sits on top of a real client call. The
Default theme is now a NEUTRAL graphite shell (`--bg-top:#191c22`,
`--bg-bot:#0e1116`, app-bg/settings/mode-menu/snip overlay all de-tinted) with a
SINGLE calm light-blue accent (`--accent:#5da9e9`, `--accent-2:#3f8ecb`,
`--accent-soft: rgba(93,169,233,.14)`) — light blue on purpose, not the standard
SaaS `#2563eb`. Purple was also hardcoded in ~30 places outside `:root`
(`rgba(124,92,255,x)`, `#cbbcff`, `#d3c8ff`, `#f4f2fb`) — those were swapped for
the blue equivalents (`rgba(93,169,233,x)`, `#9fcdf2`, `#c2dff5`, `#eef1f5`) in
`styles.css`, `onboarding.css`, `snipOverlay.html`, `indicatorWindow.html`,
`index.html` (the Default swatch dot) and the `signinFlow.js` inline page, so
nothing is left half-purple. The primary CTA is now FLAT `var(--accent)` with
near-black label text instead of a gradient, and the coloured glow shadows became
plain neutral depth shadows — gradients + glows are what made it look like a
consumer app. Matrix theme untouched (it overrides the same variables). Verified
via CDP screenshots: purpose gate, context gate, idle, transcript + answer card,
settings panel.

**Overlay opens top-centre (under the laptop camera):** it used to launch pinned
to the top-RIGHT (`x: screenWidth - winWidth - 20, y: 40`), so reading an answer
meant an obvious sideways glance on camera. `overlayWindow.js` now starts it
horizontally centred at `y: areaY + 12` — directly below the webcam, the shortest
eye movement off the lens. Uses `display.workArea` (not `workAreaSize`) so the
origin is right when the taskbar is on the top/left. Only the STARTING bounds
changed: the window is still freely draggable and width-resizable, and nothing
persists position, so every launch re-centres. Verified with a Win32
`GetWindowRect` read on the live window: work area 1536×816 → window at x=552
y=12 (centred; the 436 reported width includes the invisible DWM border), and the
"Hidden from share" indicator still sits clear at top-right.

**Listening indicator + question legibility:** the ticker's green blinking dot is
gone — `.ticker-bars` is a four-bar level meter (`@keyframes vu`, each bar on a
negative `animation-delay` so they're out of phase), in `--accent` blue to match
the repainted shell. A blink reads as a warning light; bars that keep moving read
as live input. `prefers-reduced-motion` holds them still rather than hiding the
state. The ticker only exists in focus mode, so it's on screen exactly while
capture runs. Question text went up a point everywhere it appears — `.stage-q`
11→12px and `.qa-q` `--answer-size − 3px` → `− 2px` (so it still tracks the user's
font-size setting) — as did the `.qa-typed` "YOU ASKED" chip, 9→10px.

**Floating bar (logo · Collapse/Expand · End):** a small always-visible pill above the
panel (`#hoverBar` in index.html, styled `.hover-bar` in styles.css) carrying the
three controls that must survive every state — the Confero mark, a
Collapse⇄Expand toggle, and a square End button. `body` is now a flex COLUMN (bar row + `.app`),
so `.app` is `flex:1; min-height:0` instead of `height:100%`.
- **Collapse/Expand** takes the panel off the CANDIDATE'S OWN screen — not the same
  thing as the eye toggle, which hides Confero from the SCREEN SHARE. Capture,
  transcript and the answer pipeline all keep running; Expand returns to a live
  session, not a fresh one. Collapsing must also SHRINK THE WINDOW
  (`setOverlayCollapsed` in `windows/overlayWindow.js`, IPC
  `overlay:set-collapsed`, preload `setOverlayCollapsed`): a transparent
  panel-sized window still eats every click over its area, so merely hiding the
  DOM would leave an invisible 430×720 dead zone over the meeting. Collapsed
  bounds are 190×64 — sized to the measured bar (169×41) plus shadow slack,
  because every extra pixel is transparent window that still eats clicks. The window's height lock (min==max) has to be lifted and
  re-applied around the resize — `win.__panelHeight`/`__maxWidth` remember it.
  Collapse/expand happen around the window's CURRENT centre so a dragged bar
  stays put, and expand is CLAMPED to the display's workArea — the bar is small
  enough to park in a corner, and growing back from there would push the panel
  (and its drag handle) off-screen. An answer arriving while collapsed puts an amber
  dot on Expand (`.hb-toggle.has-news`, amber so it reads on the blue button).
  Wording: the pair is COLLAPSE/EXPAND, not Hide/Ask — "hide" already means
  "hide from screen share" everywhere else in this product, and two different
  hides in one window is exactly the confusion that gets someone caught.
- **End** is the existing end-session flow, extracted to `endSessionFlow()` and
  shared with the action-bar `#endBtn`: it expands first (a report you can't see
  is useless), stops capture, then builds transcript + summary.
- The whole bar is a drag region (buttons are `no-drag`), so it doubles as the
  grab handle when the panel is collapsed and there's no header to grab.
Verified via CDP with REAL `Input.dispatchMouseEvent` clicks + Win32
`GetWindowRect`: Collapse → window 191×64 (bar measured 162×41 inside it) and the
bar renders as logo / blue "⌄ Expand" / square; Expand → back to 436×720; End from
the collapsed bar → panel returns AND the
report modal opens; 11 consecutive toggles alternate exactly (one handler hit
each); dragged to 1400,500 then expanded → clamped to x=1100 y=96, fully
on-screen. The dock tip was reworded (it told users to drag under the webcam;
the window now opens there).

**Ask bar (replaced the test-model picker):** the strip above the action bar was a
testing-only model dropdown (`#modelBar`/`#modelPicker`, gated on
`SHOW_MODEL_BADGE`) — dead weight for a customer. It's now `#askBar`: a text
input + "Ask" button that is the TYPED lane into the same answer pipeline. Two
jobs on one line — ask something the other person never said, or reshape the
answer already on screen ("in bullet points", "shorter", "more technical").
Wiring: `assist:ask` IPC → `runAnswerPipeline(text, { typed: true })`, so the
result renders through the normal `answer:pending`/`answer:ready` path, in the
same card and format as a spoken answer. Enter or the button sends; the box locks
while in flight and hands the text BACK on error (typed failures skip the
`app:error` banner so it isn't reported twice). It deliberately does NOT touch
`lastFired` — that's the spoken-question continuation window, and seeding it with
typed text would glue "in bullet points" onto the front of whatever the
interviewer says in the next 10s. Up-next is skipped for typed turns (a line I
typed isn't their turn to predict from). Typed asks are EXEMPT from the free-tier
follow-up gate for the same reason code mode is — half of what the box is for is
meaningless without the answer it refers to.
**Question vs instruction is classified in code, not by the model:**
`classifyTypedAsk()` in promptBuilder (question mark, >12 words, or any word
outside `FORM_WORDS` ⇒ question; a `REFINE_CUE` word and nothing substantive ⇒
refine). Asking the MODEL to decide was tried first and llama-3.1-8b failed it
live — "What should I say about my biggest weakness?" came back as the PREVIOUS
answer verbatim. `buildAnswerPrompt` now emits one branch only, and
`threadClause` flips with it (refine: "that text is what I want reworked";
question: "answer it on its own terms, never hand the same answer back").
**Renderer parse hardened while here:** `parseBeats` gained two fallbacks for
weak-model output — known labels on their own line WITHOUT the colon, and (last
resort) labels inline on one physical line, guarded to only split at a sentence
boundary followed by a capital so prose like "my role was to trace it" is never
torn in half. Verified: 28/28 classifier cases, 6/6 parse shapes (incl. the
false-positive guard), and live via CDP against the Render backend — typed
question → real answer, "make it shorter and less formal" → same answer
reworked, then a NEW question answered fresh; in-flight lock, Ask-button click
path, and the empty-ask guard all confirmed.

**Report modal → full-screen REPORT WINDOW (summary · transcript · ask):** the
end-of-session modal is GONE from the overlay (markup, `renderEndBody`,
`runEndSession`, `.end-*` CSS all deleted). Ending now opens
`src/renderer/report.html` in its own maximized BrowserWindow
(`windows/reportWindow.js`) — white page, neutral canvas, an 860px document card,
normal window chrome, in the taskbar, NOT content-protected (the call is over;
the point is being able to read/share/print it — `@media print` is styled).
Layout: title bar (← Back · mode · date · duration · lines · answered · Regenerate ·
Copy · Download PDF), a Summary/Transcript tab strip with "Find in transcript" (Ctrl+F,
highlights + dims non-matches), the document, and a docked **Ask about this
meeting** composer at the bottom. Transcript renders as speaker rows (time /
name / text, "You" tinted differently) by re-parsing the copyable plain-text
artifact; an unparseable one falls back to `<pre>`.
- **Main-side state:** `reportState` (what the window renders) + `reportSource`
  (a SNAPSHOT of the lines at end time — the pipeline keeps running underneath,
  so `appState.transcript` can move on) + `reportChat`. `session:end` opens the
  window as soon as the transcript is assembled and PUSHES `report:data` when the
  summary lands and again after archiving, so the user reads the transcript while
  the summary is still being written (skeleton placeholder). IPC: `report:get`
  (load/reload), `report:regenerate`, `report:ask`, `report:clear-chat`,
  `report:close`, `report:open-session` (re-open a SAVED session in the same
  window — wired to a new "Open full report" button in the past-sessions viewer).
- **Regenerate** re-runs `sessionReport.summarize` on the snapshot and writes the
  result back to the archive via the new `sessionsArchive.updateSessionSummary`,
  or Past sessions keeps serving the version the user just rejected. A failed
  regenerate leaves the old summary standing behind a `.notice` strip.
- **Ask** is grounded Q&A over transcript+summary: `buildMeetingQaPrompt` (new,
  in promptBuilder) — answer only from the material, say "That didn't come up in
  this session." rather than reaching for general knowledge, quote with the
  [mm:ss] stamp. Sends `task:'summary'` (1100 tokens / 30s / cleaners off); the
  live-answer default would cut answers off mid-list, and reusing the existing
  profile means NO backend change or Render redeploy. Long meetings are clipped
  head+tail with an elision marker. Mode-aware starter chips; thread capped at
  34vh with a header (Clear / collapse) so a long Q&A never squeezes the document.
- **Download PDF** (`report:export-pdf`): main runs `dialog.showSaveDialog`
  (defaults to Downloads, filename `Confero — <title> — <date>.pdf`, Windows-
  illegal chars stripped) then `webContents.printToPDF` (A4, `printBackground`,
  page-number footer) and writes the file; the page shows a toast with the
  filename + "Show in folder" (`report:reveal` → `shell.showItemInFolder`), and a
  cancel is a silent no-op. The PDF is NOT a snapshot of the open tab: the page
  carries a print-only `#rPrint` block holding a title block + Summary + Transcript,
  and `@media print` hides the chrome and the tab view and shows that instead, so
  the file is always the whole report (`break-before: page` between the two parts,
  `break-inside: avoid` on sections and transcript rows).
- **Leaving is "← Back", not a ✕**, and it sits on the LEFT of the title bar:
  the report is in FRONT of the app, so closing it returns you to Confero — and
  an in-page ✕ at top-right was one pixel-row away from the OS close button.
  Esc still does the same thing. The title-bar actions (Regenerate · Copy summary ·
  Download PDF) are one visual family — same white fill, same height; the primary
  one is marked by its BORDER and label colour, never a solid block, and the
  transient confirmations (copied / saved) colour the border and label green too.
- A 10px **"AI-generated content may be incorrect."** sits in the window's
  bottom-left corner (outside `.ask-inner`, or the 860px column would drag it to
  the middle) and a fuller version closes the Summary part of the PDF.
- **Overlay stands down** (`setAlwaysOnTop(false)`) while the report is open and
  goes back up when it closes — the overlay is always-on-top by design and would
  otherwise float over a maximized report.
- The shape-repair parser moved out of renderer.js into
  `src/renderer/summaryFormat.js` (`normalizeSummary` + a new `parseSummary`
  returning sections/blocks), shared by both windows: the overlay still emits its
  `.eb-*` spans for past sessions, the report window emits real `<h2>`/`<ul>`.
  Those `.eb-*` rules were scoped to `.end-body` and are now `.session-viewer`, so
  a saved summary is finally styled in the viewer too.
Verified via CDP end-to-end against a live backend: real End click with a seeded
transcript → window opens with 9 transcript rows while the skeleton shows → 4
headings / 7 bullets → "Saved to Past sessions"; overlay alwaysOnTop false during
and true after close; Regenerate (live) rewrote the archive file; Ask answered 3
questions grounded (incl. refusing one the transcript couldn't support); copy with
REAL trusted clicks read back off the OS clipboard (summary keeps its newlines,
transcript keeps its ─ rule and · separators); past-sessions "Open full report";
640px-wide layout stacks with no horizontal scroll. PDF verified by stubbing
`dialog.showSaveDialog` from the main-process inspector and clicking for real:
101KB / 4-page `%PDF-1.4` on disk, toast + "Show in folder", cancel is a no-op,
and the print layout checked with `Emulation.setEmulatedMedia({media:'print'})`
(chrome hidden, title block + both parts, 4 summary headings + 16 transcript
rows). Note the PDF's own bytes weren't text-extracted — Chromium subsets its
fonts — so the print-media DOM render is the evidence for content.
CDP note for future runs: `createReportWindow` REUSES an open window, so a CSS/JS
change needs `Page.reload({ignoreCache:true})` or the old stylesheet is what you
screenshot. The main process has no `require` in its inspector context — use
`process.getBuiltinModule('module').createRequire('D:/confero-main/package.json')`,
and match the drive-letter CASE or you get a second module-cache entry and your
`appState` writes land in a copy nobody reads.

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
4. Auto/manual toggles with explainer popups. (The screen-share toggle half of
   this is DONE — see "Hide from screen share" above.)
5. Profile email-change via OTP to recovery email, retaining paid session (needs SMTP;
   currently console-fallback only).

## Rules of engagement (user preferences)
- Never rebuild a release/APK without asking first.
- Verify UI visually (screenshot/inspect) before claiming it's done — don't assert
  from memory.
- Handle all API keys only via the gitignored `server/.env`; never print secrets.
- Stop the app before hand-editing `user-settings.json`; write no-BOM.
