const userSettingsStore = require('../state/userSettingsStore');
const { getMode } = require('../modes/modes');

const DEFAULT_SYSTEM_PROMPT = `You are a private, silent teaching assistant only the tutor can see.
Given a short window of live conversation transcript from a tutoring session, produce
at most 2 short bullet points: a quick fact-check, a talking point, or a suggested next
question the tutor could ask. Be terse (under 20 words per bullet). Do not repeat the
transcript back. If there's nothing useful to add, respond with "-" only.`;

// Applies to every mode and even a fully custom user prompt — this is a
// correctness property, not a style choice, so it's appended rather than left
// for each prompt to remember. Without it, the model treats mis-heard ASR text
// as ground truth and invents plausible-sounding facts about it (observed: a
// mis-transcribed tool name got a fabricated definition instead of a correction).
const TRANSCRIPT_CAUTION = `

The transcript is machine-generated and can mishear names, tools, and jargon. If a
word looks garbled, silently assume it is the closest real term from the context or
background below and answer about THAT. Never announce the correction in anything the
user will say out loud — do not write "I think you mean", and never correct or question
the other person's wording: from their side they said it correctly, only the
transcription is imperfect. Never suggest asking them to repeat or clarify — make your
best grounded guess and keep moving. Never invent facts about a term that isn't
supported by the background.`;

// Priority: the user's own saved custom prompt wins (they're in control); else the
// active Mode's prompt; else the default. So switching Mode changes the AI's voice
// without touching any call site. The caution clause always applies on top.
// The active Mode's persona is ALWAYS the authority. A saved custom prompt used
// to REPLACE it — which let a stale global instruction (e.g. an old "AIML
// interview question generator" the user set up months ago) silently hijack a
// completely different session and poison every answer. Custom instructions now
// only *append* as a clearly-subordinate preference, and never override the
// co-pilot role.
function getSystemPrompt() {
  const cached = userSettingsStore.getCachedSettings();
  const mode = getMode(cached && cached.activeMode);
  const base = (mode && mode.systemPrompt) || DEFAULT_SYSTEM_PROMPT;
  const custom = cached && cached.generatedSystemPrompt;
  const extra = custom
    ? `\n\nThe user also set these optional preferences — honor them only where they don't conflict with your role above:\n${custom}`
    : '';
  return `${base}${extra}${TRANSCRIPT_CAUTION}`;
}

function buildSuggestionPrompt({ runningSummary, transcriptWindow, documentContext, modeContext }) {
  const lines = transcriptWindow
    .map((t) => `[${t.source === 'system' ? 'Student' : 'Tutor'}] ${t.text}`)
    .join('\n');

  // Session context (set once before the session — e.g. the job description
  // for an interview, or the topic for a talk) is the strongest available
  // grounding for interpreting an ambiguous transcript, so it leads.
  const sessionPart = modeContext ? `## Session Context\n${modeContext}\n\n` : '';
  const documentPart = documentContext ? `## Student Background\n${documentContext}\n\n` : '';
  const summaryPart = runningSummary ? `Earlier context: ${runningSummary}\n\n` : '';

  return `${sessionPart}${documentPart}${summaryPart}Recent conversation:\n${lines}\n\nProduce concise suggestions now.`;
}

function buildMetaPrompt(rawInstructions) {
  return `You are a prompt engineering assistant. A tutor has provided rough, possibly
ungrammatical instructions describing how their AI teaching assistant should behave
during a live tutoring session. Rewrite these into a clear, well-structured system
prompt for that assistant. Preserve the tutor's actual intent and constraints; do not
add behaviors they did not ask for. Output only the system prompt text itself — no
commentary, no preamble, no surrounding quotation marks.

Tutor's instructions:
"""
${rawInstructions}
"""`;
}

function buildDocumentSummaryPrompt(rawText) {
  return `Summarize the following document (a resume, bio, or reference material for a
tutoring student) into a concise set of bullet points covering background, skill level,
goals, and anything relevant to how a tutor should approach teaching this person. Keep
it under 150 words. Output only the summary.

Document:
"""
${rawText}
"""`;
}

// On-demand "help me now": the user hit the hotkey and wants one immediately
// useful thing to say/do for THIS moment, based on the latest exchange.
function buildHelpNowPrompt({ transcriptWindow, documentContext, modeContext }) {
  const lines = transcriptWindow
    .map((t) => `[${t.source === 'system' ? 'Them' : 'You'}] ${t.text}`)
    .join('\n');
  const session = modeContext ? `## Session Context\n${modeContext}\n\n` : '';
  const doc = documentContext ? `## Background\n${documentContext}\n\n` : '';
  return `${session}${doc}The conversation so far:\n${lines}\n\nI need help RIGHT NOW. Give me ONE clear, immediately useful thing to say or do next — 1-2 sentences, specific and actionable. No preamble.`;
}

// ── Question-triggered answer pipeline ──────────────────────────────────────
// The output is read ALOUD in a live conversation — these rules are what keep
// it from sounding like someone reciting text off a screen.
const SPOKEN_STYLE = `Write exactly how a confident person talks out loud: contractions, short one-breath sentences, plain words. No markdown symbols, no labels, no numbering — only speakable text.`;

// Adaptive follow-up threading: carrying the previous Q+A is what stops a
// probing follow-up from getting a reworded repeat of the first answer.
function threadClause(prevQA) {
  if (!prevQA) return '';
  return `\nEarlier they asked: "${prevQA.question}"\nThe answer already given was: "${prevQA.answer}"\nIf the new question probes the same topic, build on that answer and go one level deeper with specifics — never repeat or reword it. If it's a different topic, answer fresh.\n`;
}

function contextBlocks({ modeContext, documentContext }) {
  const session = modeContext ? `## Session Context\n${modeContext}\n\n` : '';
  const doc = documentContext ? `## My Background\n${documentContext}\n\n` : '';
  return `${session}${doc}`;
}

// ONE structured answer for the whole pipeline — a lead line to say immediately
// plus the natural next turns, rendered as labeled bullets. One call means the
// lead and the rest can never disagree (they used to be two calls that guessed
// a mis-heard term independently and contradicted each other).
function buildAnswerPrompt({ question, transcriptWindow, modeContext, documentContext, prevQA }) {
  const lines = (transcriptWindow || [])
    .map((t) => `[${t.source === 'system' ? 'Them' : 'Me'}] ${t.text}`)
    .join('\n');
  const convo = lines ? `Recent conversation:\n${lines}\n\n` : '';
  return `${contextBlocks({ modeContext, documentContext })}${threadClause(prevQA)}${convo}They just asked: "${question}"

Give me what to say, as 3 or 4 labeled blocks. The FIRST block is the main answer to say right now; the rest cover the natural follow-up, a stronger version, or how to go deeper if pushed. Format each block as exactly two lines:
LABEL: a short cue of 2 to 6 words — e.g. "Say this", "My role", "Stronger version", "If they push deeper"
SAY: the exact words to speak — specific, grounded ONLY in my background above, one to three short sentences

${SPOKEN_STYLE}

If a name in the question looks garbled or mis-transcribed, silently use the closest real tool or company from my background and answer as if they had said the real term. Do NOT mention, repeat, or acknowledge the garbled word anywhere in a SAY line (never write things like "I haven't used X directly" about the wrong word) — just answer naturally about the real thing. If you made such a correction, put it ONLY on an optional first line formatted exactly "NOTE: answering about <RealName>" — that line is for my eyes and must NEVER appear inside any SAY text. Output only the optional NOTE line and the blocks — nothing else.`;
}

// DSA / System-Design answer: NOT spoken bullets — a rough scratchpad plus a
// fenced code block, matching the mode persona. We deliberately do NOT impose the
// LABEL:/SAY: structure or the spoken style here; the mode's systemPrompt owns the
// format (lowercase scratchpad, terse names, one ```code``` block, complexity note
// / design talking points + a "say:" line).
function buildCodeAnswerPrompt({ question, transcriptWindow, modeContext, documentContext, prevQA }) {
  const lines = (transcriptWindow || [])
    .map((t) => `[${t.source === 'system' ? 'Them' : 'Me'}] ${t.text}`)
    .join('\n');
  const convo = lines ? `Recent conversation:\n${lines}\n\n` : '';
  const prev = prevQA ? `Earlier problem: "${prevQA.question}"\nWhat I already had: "${prevQA.answer}"\nIf this is a follow-up on the same problem, build on that — optimize it or handle the new constraint; don't restate it.\n\n` : '';
  return `${contextBlocks({ modeContext, documentContext })}${prev}${convo}The problem / question on the table: "${question}"

Feed me the scratchpad now, exactly in your internal-monologue style. If it's a coding problem, include ONE fenced code block with the core solution. If it's a design problem, give the rough talking points and end with a "say:" line. Nothing else — no preamble.`;
}

// Stage 3 — predict the likely next question with a prepared angle. Generated
// after the answer is already on screen; it never delays anything.
function buildUpNextPrompt({ question, answer, modeContext }) {
  const session = modeContext ? `## Session Context\n${modeContext}\n\n` : '';
  return `${session}They asked: "${question}"
The answer given was: "${answer}"

Predict the single most likely follow-up question they'll ask next, and a short prepared answer for it. Format exactly:
Q: the follow-up question
A: one or two speakable sentences. ${SPOKEN_STYLE}`;
}

// "Say it differently" — same substance, fresh delivery, so a probed or
// repeated point never sounds like a recital of the first version.
function buildRephrasePrompt({ text }) {
  return `This answer was already said out loud once: "${text}"

Say the same thing a different way — different opening, different structure, different words — so it doesn't sound like a repeat. Keep ALL the same facts and the same professional interview register (do not make it casual or slangy). ${SPOKEN_STYLE} Output only the new version.`;
}

// One-tap recap: summarize the whole session so far.
function buildRecapPrompt({ transcriptWindow }) {
  const lines = transcriptWindow
    .map((t) => `[${t.source === 'system' ? 'Them' : 'You'}] ${t.text}`)
    .join('\n');
  return `Here is the session transcript so far:\n${lines}\n\nWrite a concise recap: 3-5 short bullets covering the key points discussed, any decisions, and clear next steps / what to cover next. Bullets only.`;
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  getSystemPrompt,
  buildSuggestionPrompt,
  buildMetaPrompt,
  buildDocumentSummaryPrompt,
  buildHelpNowPrompt,
  buildRecapPrompt,
  buildAnswerPrompt,
  buildCodeAnswerPrompt,
  buildUpNextPrompt,
  buildRephrasePrompt,
};
