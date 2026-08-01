// What the interviewer has said since the last answer — the question, in full.
//
// This replaced a 1.3s "settle window" that tried to guess where one question
// ended and the next began. With answers on a button that timer had nothing left
// to decide, and it was wrong in both directions: a genuine mid-question pause
// always outran it (the VAD needs 1.5s of silence, then Whisper needs a round
// trip, so the second half landed seconds later and became its own question),
// while anything that DID arrive inside the window was appended regardless of
// what it was about.
//
// So the boundary is now the click: pressing "Answer now" takes everything in
// here as the question and clears it, so the next utterance starts question N+1.
// Deciding what was actually asked inside that stretch of speech is the model's
// job — it can see the preamble, the aside and the restatement.

// Fraction of `candidate`'s meaningful words already present in `haystack`.
// Used two ways: to drop a re-emitted or echoed line here, and (in main) to spot
// the interviewer's voice bleeding into the candidate's mic on speakers.
function overlapRatio(haystack, candidate) {
  const have = new Set(String(haystack).toLowerCase().split(/\W+/).filter((w) => w.length >= 3));
  const words = String(candidate).toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
  if (!words.length) return 1;
  let hits = 0;
  for (const w of words) if (have.has(w)) hits++;
  return hits / words.length;
}

const DEFAULTS = {
  maxLines: 14,
  maxChars: 2400,
  // A buffer only grows while the candidate isn't asking for help. If they went
  // five minutes without pressing it, the opening of that stretch is no longer
  // what they need answered.
  maxAgeMs: 5 * 60 * 1000,
  // Above this overlap with the line before it, a line is a duplicate (Whisper
  // re-emitting a tail, or mic bleed) rather than new speech.
  dupeRatio: 0.7,
};

function createAskBuffer(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const now = () => (cfg.now ? cfg.now() : Date.now());
  let lines = []; // [{ text, at }]

  const text = () => lines.map((l) => l.text).join(' ').trim();

  function trim() {
    const cutoff = now() - cfg.maxAgeMs;
    lines = lines.filter((l) => l.at >= cutoff);
    while (lines.length > cfg.maxLines) lines.shift();
    // Always keep the newest line whatever its length — it's the most likely to
    // BE the question.
    while (lines.length > 1 && text().length > cfg.maxChars) lines.shift();
  }

  return {
    // Returns true if the line was added, false if it was folded in as a
    // duplicate. Everything is kept, not just question-shaped lines: a question
    // routinely arrives wrapped in context ("So I saw you worked on ingestion.
    // That's interesting. How did you handle backpressure?"), and dropping the
    // wrapper throws away what makes the ask answerable.
    push(raw) {
      const line = String(raw || '').trim();
      if (!line) return false;
      const last = lines[lines.length - 1];
      if (last && overlapRatio(last.text, line) >= cfg.dupeRatio) {
        last.at = now(); // still fresh activity, just not new words
        return false;
      }
      lines.push({ text: line, at: now() });
      trim();
      return true;
    },
    text,
    size: () => lines.length,
    isEmpty: () => text().length === 0,
    clear() { lines = []; },
  };
}

module.exports = { createAskBuffer, overlapRatio, DEFAULTS };
