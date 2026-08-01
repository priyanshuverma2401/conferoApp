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
// ── Typed asks: is this a question, or an instruction about the last answer? ──
// Asking the MODEL to decide was tried first and fails on weak models: given a
// previous answer plus a "rework it" branch, llama-3.1-8b took "What should I
// say about my biggest weakness?" as an instruction and handed back the previous
// answer verbatim. The classification is cheap and mechanical, so we make it
// here and hand the model exactly ONE job.
//
// FORM_WORDS is every word that can appear in a pure formatting request; a typed
// line is a refine ONLY if it has a formatting cue and NOTHING outside this set
// — one substantive word ("weakness", "CAP theorem") means it's a question about
// that thing, however it's phrased.
const FORM_WORDS = new Set(`a an the it that this is are be and or but not no of for to in into on as with
  more less much very too just please keep make made give given say said write put use using redo again same
  answer answers response reply one two three four five few some all my me i you your we us up down out go back
  first second third last next other another point points bullet bullets list lists form format formatted
  version style tone way ways word words line lines sentence sentences paragraph paragraphs step steps numbered
  number short shorter shortest brief briefly concise long longer detail details detailed deep deeper expand
  elaborate simple simpler simplify easy easier casual formal professional technical human natural summary
  summarise summarize rewrite reword rephrase reformat restructure structure structured translate only plus
  then now ok english hindi spanish french java python javascript typescript sql golang`.split(/\s+/));

// At least one of these must appear, or it isn't a formatting request at all.
const REFINE_CUE = /\b(short|shorter|brief|briefly|concise|long|longer|bullet|bullets|list|format|formatted|rewrite|reword|rephrase|reformat|redo|again|expand|elaborate|detail|detailed|deeper|simple|simpler|simplify|casual|formal|technical|tone|style|summary|summarise|summarize|numbered|paragraph|sentence|sentences|steps|translate|english|hindi|spanish|french|java|python|javascript|typescript|sql)\b/i;

function classifyTypedAsk(text) {
  const t = (text || '').trim();
  if (!t) return 'question';
  if (t.includes('?')) return 'question';          // a question mark settles it
  const words = t.toLowerCase().match(/[a-z0-9+#']+/g) || [];
  if (words.length > 12) return 'question';        // instructions are short
  if (!REFINE_CUE.test(t)) return 'question';
  return words.every((w) => FORM_WORDS.has(w)) ? 'refine' : 'question';
}

// `typedAsk` flips the meaning of the previous turn: for a spoken follow-up the
// old answer is something to build PAST, but for a typed instruction ("shorter",
// "in bullets") it's the very text being reworked — so the usual "never repeat
// it" rule would tell the model to do the opposite of what was asked.
function threadClause(prevQA, typedKind) {
  if (!prevQA) return '';
  if (typedKind === 'refine') {
    return `\nThe question on the table was: "${prevQA.question}"\nThe answer currently on my screen is: "${prevQA.answer}"\nThat text is what I want reworked below.\n`;
  }
  if (typedKind === 'question') {
    return `\nFor context, the last answer on my screen was: "${prevQA.answer}"\nWhat I'm typing below is a NEW question — answer it on its own terms. Only reuse anything above if it genuinely helps answer it, and never hand the same answer back.\n`;
  }
  return `\nEarlier they asked: "${prevQA.question}"\nThe answer already given was: "${prevQA.answer}"\nIf the new question probes the same topic, build on that answer and go one level deeper with specifics — never repeat or reword it. If it's a different topic, answer fresh.\n`;
}

function contextBlocks({ modeContext, documentContext }) {
  const session = modeContext ? `## Session Context\n${modeContext}\n\n` : '';
  const doc = documentContext ? `## My Background\n${documentContext}\n\n` : '';
  return `${session}${doc}`;
}

// The candidate's own earlier statements this session (mic / [Me]), kept past the
// recent window so an interviewer follow-up on something they said 4-5 questions
// ago — a project, a tool, a design choice — can be answered from what they
// ACTUALLY told them, not invented. Kept separate from the interviewer's turns on
// purpose: this is the candidate's record.
function candidateNotesBlock(candidateNotes) {
  if (!candidateNotes || !candidateNotes.length) return '';
  const lines = candidateNotes.map((n) => `- ${n}`).join('\n');
  return `## What I've already told them earlier this session\n${lines}\nIf their question follows up on any of this (a project, tool, or decision I mentioned), ground the answer in what I actually said above — stay consistent with it, don't contradict or invent.\n\n`;
}

// ONE structured answer for the whole pipeline — a lead line to say immediately
// plus the natural next turns, rendered as labeled bullets. One call means the
// lead and the rest can never disagree (they used to be two calls that guessed
// a mis-heard term independently and contradicted each other).
// "What am I answering" has three possible sources, and the prompt may only ever
// carry one — so they live together here:
//   refine   — a line I typed about the answer already on screen ("shorter")
//   question — a question I typed myself
//   spoken   — the usual case: a stretch of their speech off the live transcript
//
// The spoken case is not a tidy one-liner. It's everything they said since the
// last answer, so it carries preamble, a self-correction and sometimes two asks
// in a row. Without saying that explicitly, weak models answer the FIRST sentence
// they see — which is usually the throat-clearing.
function askedBlock({ question, rawSpeech, typedKind }) {
  if (typedKind === 'refine') {
    return `I typed this to you privately — the other person did NOT say it. It is an instruction about the answer already on my screen:
"${question}"

Give me that SAME answer again, reworked exactly as I asked. Keep every fact and all of the substance — change only what I asked you to change. Do not treat my instruction as a question to answer, and do not move to a new topic. Apply it INSIDE the block structure below: that structure is what my screen renders, so never abandon it.`;
  }
  if (typedKind === 'question') {
    return `I typed this question to you privately — the other person did NOT say it:
"${question}"

Answer it directly, using the conversation and my background above. It is my own question, not theirs, so answer what I actually asked.`;
  }
  if (!rawSpeech) return `They just asked: "${question}"`;
  return `Everything they have said since my last answer, straight off the live transcript:
"${question}"

That is raw speech: it may run several sentences, wander, restate itself, or open
with context before the actual ask. Work out what they are really asking me and
answer THAT — not the preamble.

Interviewers routinely stack two or three asks into one breath ("what did you
build, how did you test it, and what would you change?"). Identify EVERY distinct
thing they asked and answer ALL of them — nothing may be skipped, merged away, or
left for me to bring up later. The only things to ignore are the throat-clearing
and the asides that ask nothing. If they only made statements and never asked
anything, respond to the point they were making.`;
}

// When the asks could be separated locally (splitAsks), the model is handed the
// list instead of being asked to find and count them. One flat rule — a block
// per number — is something even the weakest fallback model follows; "work out
// how many they asked, then choose a format" is not (observed: it answered the
// first and padded the rest with the template's own example labels).
function asksList(asks) {
  const list = asks.map((a, i) => `${i + 1}. ${a}`).join('\n');
  return `\nThey asked ${asks.length} separate things:\n${list}\n\nAnswer EVERY one of them. Block 1 answers question 1, block 2 answers question 2, and so on, in that order. Do not stop after the first. Do not merge two of them into one block. Do not spend a block on a follow-up or a stronger version until all ${asks.length} have their own.\n`;
}

function buildAnswerPrompt({ question, rawSpeech, asks, transcriptWindow, candidateNotes, modeContext, documentContext, prevQA, typedAsk }) {
  const lines = (transcriptWindow || [])
    .map((t) => `[${t.source === 'system' ? 'Interviewer' : 'Me'}] ${t.text}`)
    .join('\n');
  const convo = lines ? `Recent conversation ([Interviewer] = them, [Me] = what I said):\n${lines}\n\n` : '';
  // Typed asks come from ME, not from them — and they arrive in two shapes: a
  // question of my own, or an instruction about the answer already on screen
  // ("shorter", "in bullet points"). Which one it is is decided here, not by the
  // model, so it only ever gets one job. With nothing on screen yet there's
  // nothing to rework, so everything is a question.
  const typedKind = typedAsk ? (prevQA ? classifyTypedAsk(question) : 'question') : null;
  // Enumerating the asks only applies to captured SPEECH. A typed line is
  // already exactly one question, and a refine has to keep the shape of the
  // answer it is reworking.
  const multi = !typedKind && Array.isArray(asks) && asks.length > 1;

  // Two different jobs, so two different specs — never a rule the model has to
  // pick between. Note the label EXAMPLES differ too: weak models copy them
  // verbatim, which is how a three-question ask came back as
  // "Say this / My role / Stronger version / If they push deeper".
  const blockSpec = multi
    ? `Give me exactly ${asks.length} blocks — one per numbered question above, in that order. Name each block after the question it answers. Format each block as exactly two lines:
LABEL: a short cue of 2 to 6 words naming that question — e.g. "What SOLID is", "How we tested it", "What I'd change"
SAY: the exact words to speak for THAT question — specific, grounded ONLY in my background above, one to three short sentences`
    : `Give me what to say, as 3 or 4 labeled blocks. The FIRST block is the main answer to say right now; the rest cover the natural follow-up, a stronger version, or how to go deeper if pushed. Format each block as exactly two lines:
LABEL: a short cue of 2 to 6 words — e.g. "Say this", "My role", "Stronger version", "If they push deeper"
SAY: the exact words to speak — specific, grounded ONLY in my background above, one to three short sentences`;

  return `${contextBlocks({ modeContext, documentContext })}${candidateNotesBlock(candidateNotes)}${threadClause(prevQA, typedKind)}${convo}${askedBlock({ question, rawSpeech, typedKind })}
${multi ? asksList(asks) : ''}
${blockSpec}

Never leave any part of what they asked unanswered — a half-answered multi-part question is worse than a brief one. If space is tight, make each SAY shorter rather than dropping a part.

${SPOKEN_STYLE}

If a name in the question looks garbled or mis-transcribed, silently use the closest real tool or company from my background and answer as if they had said the real term. Do NOT mention, repeat, or acknowledge the garbled word anywhere in a SAY line (never write things like "I haven't used X directly" about the wrong word) — just answer naturally about the real thing. If you made such a correction, put it ONLY on an optional first line formatted exactly "NOTE: answering about <RealName>" — that line is for my eyes and must NEVER appear inside any SAY text. Output only the optional NOTE line and the blocks — nothing else.`;
}

// DSA / System-Design answer: NOT spoken bullets — a rough scratchpad plus a
// fenced code block, matching the mode persona. We deliberately do NOT impose the
// LABEL:/SAY: structure or the spoken style here; the mode's systemPrompt owns the
// format (lowercase scratchpad, terse names, one ```code``` block, complexity note
// / design talking points + a "say:" line).
function buildCodeAnswerPrompt({ question, rawSpeech, transcriptWindow, candidateNotes, modeContext, documentContext, prevQA, anchoredProblem, typedAsk }) {
  const lines = (transcriptWindow || [])
    .map((t) => `[${t.source === 'system' ? 'Interviewer' : 'Me'}] ${t.text}`)
    .join('\n');
  const convo = lines ? `Recent conversation ([Interviewer] = them, [Me] = what I said):\n${lines}\n\n` : '';
  const prev = prevQA ? `What I already gave them (my current solution / notes):\n"${prevQA.answer}"\nIf this turn builds on the same problem, extend THIS — optimize it, dry-run it, or handle the new constraint; don't restate what's already there.\n\n` : '';
  // The anchored problem is the interviewer's on-screen question — the stable
  // spine of the round. When present, `question` is a follow-up instruction
  // about it ("walk me through the approach first", "dry run [3,1,2]", "make it
  // O(1) space"), NOT a fresh problem — so we frame them separately.
  const hasAnchor = anchoredProblem && anchoredProblem.trim() && anchoredProblem.trim() !== (question || '').trim();
  // A typed turn is me talking to you, not the interviewer — same anchored
  // problem, but the instruction is mine ("just the complexity", "in Java").
  const now = typedAsk ? `What I'm asking you for right now (I typed this — they did not say it)` : `What they're asking me to do right now`;
  // Same raw-speech framing as the spoken prompt: with an anchored problem the
  // stretch is an instruction ABOUT it, without one it has to be read for the
  // problem itself. Never set for a typed turn — that text is already the ask.
  const rawNote = rawSpeech && !typedAsk
    ? '\nThat is raw speech off the live transcript — several sentences, possibly with preamble or a restatement. Read it for what they actually want done, and ignore the throat-clearing.\n'
    : '';
  const anchor = hasAnchor
    ? `The problem on the screen (fixed for this round):\n"${anchoredProblem.trim()}"\n\n${now}:\n"${question}"\n${rawNote}\n`
    : `The problem / question on the table: "${question}"\n${rawNote}\n`;
  return `${contextBlocks({ modeContext, documentContext })}${candidateNotesBlock(candidateNotes)}${prev}${convo}${anchor}Feed me the scratchpad now, exactly in your internal-monologue style.

DEFAULT (do this unless the turn explicitly asks for something narrower): a couple of rough lines naming the pattern and approach, THEN the core solution in ONE fenced \`\`\`code block, THEN one line on time and space complexity. For a system / LLD design problem instead give 3-4 rough talking points and end with a "say:" line.

Only if this turn explicitly asks for something narrower, do JUST that instead:
- asks for the approach / intuition only → give the approach in words, no code block yet
- asks for a dry run / trace → walk the current code line by line on their example, showing how the key variables change, no rewrite
- asks only for complexity → just the time/space analysis and whether it optimizes
- asks to optimize or handle a new constraint → revise the solution I already have, don't rebuild from scratch

Nothing else — no preamble, no markdown headers.`;
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

// ── End-of-session report ────────────────────────────────────────────────────
// What a summary should emphasise depends on what the session WAS: an interview
// debrief is about the questions asked and how they landed; a meeting is about
// decisions and who owes what. Same skeleton, mode-specific middle section.
const SUMMARY_SHAPES = {
  interview: {
    heading: 'QUESTIONS & HOW THEY WERE ANSWERED',
    focus: `Every question the interviewer asked, with a one-line note on how it was answered.
Where the answer was strong, and where it was thin, vague, or missed.
What to prepare before the next round.`,
  },
  dsa: {
    heading: 'PROBLEMS & APPROACHES',
    focus: `Each coding or design problem discussed, and the approach that was settled on.
Complexity and trade-offs that came up.
Anything left unresolved or worth practicing again.`,
  },
  professional: {
    heading: 'DECISIONS',
    focus: `Decisions that were made, and by whom when it was stated.
Commitments, owners, and dates that were actually named.
Open questions or anything blocked.`,
  },
  tutoring: {
    heading: 'WHAT WAS COVERED',
    focus: `Concepts taught and how they were explained.
Where the learner struggled or asked for clarification.
Homework, practice, or next topics that were agreed.`,
  },
  general: {
    heading: 'DECISIONS & CONCLUSIONS',
    focus: `The main topics discussed and any conclusions reached.
Commitments or next steps that were named.
Open questions.`,
  },
};

// Long sessions are summarized in two passes; this is pass one, per chunk.
function buildTranscriptNotesPrompt({ transcriptText, part, total }) {
  return `This is part ${part} of ${total} of a live conversation transcript (machine-transcribed, so
names and jargon may be slightly misheard — read them charitably, and never invent detail
that isn't there).

${transcriptText}

Write dense factual notes on THIS part only: what was asked, what was answered, any
decisions, numbers, names, commitments, and open threads. Short bullets. No preamble,
no summary of the summary — these notes get merged with the other parts afterwards.`;
}

function buildSessionSummaryPrompt({ transcriptText, notes, modeId, modeLabel, modeContext, documentContext }) {
  const shape = SUMMARY_SHAPES[modeId] || SUMMARY_SHAPES.general;
  const contextPart = modeContext ? `## Session context (set before the session)\n${modeContext}\n\n` : '';
  const docPart = documentContext ? `## Background document\n${documentContext}\n\n` : '';
  const body = notes
    ? `## Notes taken across the full session, in order\n${notes.join('\n\n')}`
    : `## Full transcript\n${transcriptText}`;

  return `${contextPart}${docPart}${body}

Write the closing summary of this ${modeLabel || 'session'} for the person who was in it.
Focus on:
${shape.focus}

Ground every line in the material above. The transcript is machine-generated, so treat a
garbled word as the closest real term from the context — but never invent a fact, a name,
a number, or a commitment that isn't there.

This summary is READ, not spoken — it has to scan in a few seconds, like a good set of
meeting minutes. Reproduce the template below EXACTLY: the four headings in CAPITALS,
each alone on its own line, in this order. Plain text only — no markdown, no asterisks,
no "#", no numbered lists, no preamble, no sign-off.

OVERVIEW
One or two sentences on what this session was and how it went.

KEY POINTS
- the substance of what was discussed, one point per line
- another point

${shape.heading}
- one per line

ACTION ITEMS & NEXT STEPS
- verb first, naming the owner and the date whenever one was actually stated

Formatting rules — these matter as much as the content:
- Every single line under a bullet heading MUST begin with "- ". Never write a paragraph
  under a bullet heading, and never run several points together into one long bullet.
- One idea per bullet, one line each, roughly 8 to 20 words. Trim filler; keep the number,
  the name, and the date.
- Aim for 3 to 6 bullets per section where the material supports it. If a section has
  nothing real in it, write exactly one bullet: "- None stated."
- OVERVIEW is the only section written as sentences, and it stays under three.`;
}

// The closing report is a document the user can interrogate — "what did I commit
// to?", "how did I answer the sharding question?" — instead of re-reading twenty
// minutes of transcript. Grounding is the whole contract here: a recap that
// invents a commitment or a name is worse than no recap, so the model is told to
// say the thing didn't come up rather than reach for its own knowledge.
function buildMeetingQaPrompt({ question, transcriptText, summary, modeLabel, history }) {
  const summaryPart = summary ? `## Summary of the session\n${summary}\n\n` : '';
  const historyPart = history && history.length
    ? `## Earlier in this Q&A\n${history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join('\n\n')}\n\n`
    : '';

  return `${summaryPart}## Transcript of the session
${transcriptText}

${historyPart}## The user's question about this ${modeLabel || 'session'}
${question}

Answer using ONLY the material above. Rules:
- If the answer isn't in the transcript or summary, say so plainly in one line
  ("That didn't come up in this session.") and stop. Never fill the gap from
  general knowledge, and never invent a name, number, date or commitment.
- The transcript is machine-generated, so read a garbled word as the closest real
  term from the context.
- Be direct and short — under 120 words unless the question asks for a list.
- Plain text. Use "- " bullets when you're listing things, one idea per bullet.
  No markdown, no headings, no preamble, no sign-off.
- Quote the speaker in a few words with their [mm:ss] stamp when it settles the
  question ("at [12:04] you said …").
- Speak to the user as "you", and call the other side by the label the transcript
  uses.`;
}

module.exports = {
  DEFAULT_SYSTEM_PROMPT,
  getSystemPrompt,
  buildSessionSummaryPrompt,
  buildMeetingQaPrompt,
  buildTranscriptNotesPrompt,
  buildSuggestionPrompt,
  buildMetaPrompt,
  buildDocumentSummaryPrompt,
  buildHelpNowPrompt,
  buildRecapPrompt,
  buildAnswerPrompt,
  buildCodeAnswerPrompt,
  classifyTypedAsk, // exported for testing the ask-bar routing
  buildUpNextPrompt,
  buildRephrasePrompt,
};
