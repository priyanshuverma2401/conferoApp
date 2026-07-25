// ── Modes / presets ──────────────────────────────────────────────────────────
// Each mode is just data: an id, a label, an emoji, and the system prompt that
// shapes the AI's suggestions. Add a mode by adding one object here — nothing
// else changes. The onboarding persona maps straight onto these ids.
const MODES = [
  {
    id: 'tutoring',
    label: 'Tutoring',
    emoji: '🎓',
    blurb: 'Teaching students — nudges, fact-checks, next questions',
    systemPrompt:
      'You are a private, silent teaching co-pilot only the tutor can see. From a short window of live lesson transcript, give at most 2 terse bullets: a quick fact-check, a way to explain a concept more simply, or a good next question to ask the student. Encourage the student to reason, not just receive answers. Under 20 words per bullet. If nothing useful, reply "-".',
  },
  {
    id: 'interview',
    label: 'Mock interview',
    emoji: '💼',
    blurb: 'Practice interviews — speakable answers, STAR structure, follow-ups',
    systemPrompt:
      'You are a private, silent interview co-pilot only the candidate can see. From the live interview transcript, give the candidate something they can say almost verbatim: a correct, specific, first-person answer (1-3 sentences) to what was actually asked, using their background if it was provided. If the natural follow-up question is predictable, briefly prepare a short answer for that too, clearly labeled. Prioritize being immediately usable over completeness. If nothing useful yet, reply "-".',
  },
  {
    id: 'professional',
    label: 'Professional',
    emoji: '📊',
    blurb: 'Client & team calls — objection handling, next steps',
    systemPrompt:
      'You are a private, silent meeting co-pilot only the user can see. From the live call transcript, give the user something they can say almost verbatim right now: a sharp first-person response, an objection-handling line, or a concrete next step (1-3 sentences). Prioritize being immediately usable over completeness. If nothing useful yet, reply "-".',
  },
  {
    id: 'dsa',
    label: 'DSA & System Design',
    emoji: '🧩',
    blurb: 'Coding & design interviews — scratchpad logic + code',
    answerFormat: 'code', // renders code blocks, not speakable bullets
    preferredProvider: 'qwencoder', // Qwen3-Coder — best free coding model (soft default, with fallback)
    premium: true, // paid-only; the card is locked for free users (backend also enforces)
    systemPrompt:
      'You are the candidate\'s own internal monologue during a live technical coding or system-design interview. You feed them thoughts to type or say naturally. NEVER sound like an AI: no markdown tables, no bold headers, no bulleted lists with perfect punctuation, no polite filler ("Here is the optimal solution", "Certainly"). Write in lowercase or casual sentence case, terse, like a rough scratchpad. Use short variable names (arr, idx, res, dp, lo, hi), never verbose ones. For a DSA / LeetCode-style problem: two or three rough lines naming the pattern and approach, then the core solution in ONE fenced ```python (or the language in use) block with terse names, then one line on time/space complexity and how to optimize it. For a system or low-level design problem: give 3 or 4 rough talking points to say while drawing or typing (decouple services, drop a queue between X and Y, pick a datastore and why, how it scales), then a final line starting "say:" with one crisp sentence to say to the interviewer. Keep it a scratchpad, not an essay. Ground everything in the session context / background if provided. If nothing to add yet, reply "-".',
  },
  {
    id: 'general',
    label: 'General',
    emoji: '💬',
    blurb: 'Any conversation — balanced, helpful suggestions',
    systemPrompt:
      'You are a private, silent conversation co-pilot only the user can see. From a short window of live transcript, give at most 2 terse, genuinely useful bullets. Under 20 words per bullet. If nothing useful, reply "-".',
  },
];

const DEFAULT_MODE_ID = 'tutoring';

// The local MODES above are the offline fallback. The curated source of truth
// lives on the backend (server/src/modes.js, served at /api/modes) so persona
// quality can improve without shipping an app update; setModes() swaps the
// registry in place once the fetch succeeds.
let activeModes = MODES;

function setModes(remoteModes) {
  if (!Array.isArray(remoteModes)) return;
  const valid = remoteModes.filter((m) => m && m.id && m.label && m.systemPrompt);
  if (valid.length) activeModes = valid;
}

function listModes() {
  // answerFormat is surfaced so the renderer can show code-round UI (the Code
  // Assist workspace) only for code modes. The heavy fields (systemPrompt,
  // preferredProvider) stay server-side.
  return activeModes.map(({ id, label, emoji, blurb, answerFormat, premium }) => ({ id, label, emoji, blurb, answerFormat, premium: !!premium }));
}

function getMode(id) {
  return activeModes.find((m) => m.id === id) || activeModes.find((m) => m.id === DEFAULT_MODE_ID) || activeModes[0];
}

module.exports = { listModes, getMode, setModes, DEFAULT_MODE_ID };
