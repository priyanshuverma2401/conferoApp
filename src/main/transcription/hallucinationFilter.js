// Whisper models are trained on huge amounts of YouTube audio, so on quiet or
// ambiguous chunks they sometimes hallucinate stock outro phrases instead of
// returning silence. Filter these out as a second line of defense behind the
// renderer's silence-energy gate (audioCapture.js), which catches most of these
// before they're ever sent for transcription.
const HALLUCINATION_PHRASES = [
  'thank you',
  'thanks for watching',
  'thank you for watching',
  'please subscribe',
  'subscribe to my channel',
  'like and subscribe',
  'ご視聴ありがとうございました',
  '字幕',
  'amara.org',
  'bye bye',
  'amen',
  'the end',
];

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[.,!?。、]/g, '')
    .trim();
}

// `meta` (optional) carries Whisper's own confidence signals for this segment:
// avg_logprob (how confident the model was in the tokens it chose) and
// no_speech_prob (how likely this audio was actually silence/noise). These are
// far more robust than any fixed phrase list, since Whisper can hallucinate
// arbitrary plausible-sounding text on breath/noise, not just stock outro
// phrases (observed live: "Amen.", "you", "so", "I'm not sure. I'm not sure."
// appearing during silence and poisoning the suggestion context).
// Whisper falls into degenerate loops on silence/near-silence, emitting the
// same token or short phrase over and over ("AI, and AI, and AI…", "you you
// you", "I'm not sure. I'm not sure."). No real utterance repeats one word 3+
// times, so a low unique-word ratio on a multi-word line is a reliable junk
// signal independent of the confidence scores (which loops can score OK on).
function isRepetitionLoop(normalized) {
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  const unique = new Set(words);
  // e.g. "ai and ai and ai and ai" → 2 unique / 7 words. Real speech rarely
  // dips below ~40% unique over a short line.
  if (unique.size / words.length <= 0.34) return true;
  // Also catch an immediately-repeating short phrase ("i'm not sure i'm not sure").
  const half = Math.floor(words.length / 2);
  if (half >= 2 && words.slice(0, half).join(' ') === words.slice(half, half * 2).join(' ')) return true;
  return false;
}

function isLikelyHallucination(text, meta) {
  const normalized = normalize(text);
  if (!normalized) return true;
  if (HALLUCINATION_PHRASES.includes(normalized)) return true;
  if (isRepetitionLoop(normalized)) return true;
  if (meta) {
    const logprob = typeof meta.avg_logprob === 'number' ? meta.avg_logprob : null;
    const noSpeech = typeof meta.no_speech_prob === 'number' ? meta.no_speech_prob : null;
    // Strong single signals — either alone means the segment is junk.
    if (noSpeech !== null && noSpeech > 0.85) return true;
    if (logprob !== null && logprob < -1.25) return true;
    // Moderate signals together.
    if (logprob !== null && noSpeech !== null && logprob < -1 && noSpeech > 0.6) return true;
    // One-or-two-word fragments ("you", "so", "Amen.") are the classic
    // breath-noise hallucination shape — hold them to a stricter bar. Real
    // short replies ("Yes.") come from actual speech and score confidently.
    const wordCount = normalized.split(/\s+/).length;
    if (wordCount <= 2 && ((noSpeech !== null && noSpeech > 0.5) || (logprob !== null && logprob < -0.7))) return true;
  }
  return false;
}

module.exports = { isLikelyHallucination };
