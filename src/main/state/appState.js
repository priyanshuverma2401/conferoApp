// Single in-memory state store for the running session. No persistence by design —
// this app is meant to hold nothing beyond the current call.
const state = {
  stealthEnabled: true,
  capturing: false,
  transcript: [], // { source: 'system'|'mic', text, timestamp, readBack?, isQuestion? }
  runningSummary: '',

  plan: 'free', // refreshed from backend /api/me at startup
  lastQA: null, // { question, answer } — thread state for adaptive follow-ups
  sawSystemAudio: false, // once true, only [Them] speech triggers answers
  adaptiveUsed: 0, // free-tier counter, reset each capture session
  rephraseUsed: 0, // free-tier counter, reset each capture session
  recentAnswers: [], // Sets of tokens from recent generated answers, for read-back detection
  sessionAnswers: [], // { kind, question?, text, at } — everything shown this session, for archiving

  // Code Assist workspace (DSA / LLD rounds): the problem the interviewer put on
  // screen, pasted by the candidate. It stays anchored for the whole round so
  // every later turn — "explain your approach", "dry run [3,1,2]", "now optimize
  // space" — is answered against it, whether that turn arrives by paste or by
  // the interviewer's voice. Cleared on session start / re-anchor.
  activeCodingProblem: null, // string | null
};

module.exports = state;
