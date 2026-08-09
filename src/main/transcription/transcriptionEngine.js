const groqProvider = require('./providers/groqProvider');
const backendProvider = require('./providers/backendProvider');
const userSettingsStore = require('../state/userSettingsStore');
const vocabularyBank = require('./vocabularyBank');

// Provider-agnostic transcription interface. 'backend' (default) routes through
// Confero's server; 'groq' is the direct/BYOK dev path.
// Groq 400s on a Whisper prompt over 896 CHARACTERS, and since the hint is built
// the same way for every chunk, going over doesn't cost one chunk — it kills the
// whole session. The old cap here was 950, which a mode context plus an attached
// résumé summary reached easily (~944), so transcription died the moment a user
// uploaded a CV. Sit under the real limit rather than on it: the server clamps at
// 896 as a backstop, and this leaves room so that backstop stays a backstop.
const HINT_MAX_CHARS = 850;

function createTranscriptionEngine(config) {
  // Whisper's `prompt` biases transcription toward the terms it contains — so
  // alongside the explicit vocabulary hints, feed it the active mode's session
  // context (job description, lesson topic...). A term like "Fenergo" that
  // appears there gets transcribed correctly at the source instead of arriving
  // as "Fenegrou" and needing a downstream correction. Capped under Groq's hard
  // limit — see HINT_MAX_CHARS below; it counts CHARACTERS, not the ~224 TOKENS
  // Whisper's prompt limit is usually quoted as.
  // Whisper ECHOES leading title-like tokens from its prompt into the output —
  // a markdown header like "**Background**" at the top of a doc summary comes
  // back glued to the front of the very next utterance ("**Background** So,
  // tell me…"), corrupting the question. So flatten the hint to plain running
  // text: strip emphasis/header/list/quote/code/link markup and newlines so
  // there's no header token for Whisper to parrot, keeping only the proper
  // nouns that actually bias transcription.
  const flatten = (s) =>
    String(s || '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // md links -> visible text
      .replace(/[*_`~#>|]+/g, ' ') // emphasis, headers, code, quotes, tables
      .replace(/^\s*[-+]\s+/gm, '') // list bullets
      .replace(/\r?\n+/g, '. ') // newlines -> sentence breaks, not titles
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .trim();

  // The document summarizer is told to produce "background, skill level, goals"
  // sections, so the summary is scaffolded with those exact generic labels.
  // Whisper parrots the salient one back on near-silent mic input ("Goals,
  // Kodika, Maha…"), adding pure noise — the labels bias nothing useful (the
  // domain proper nouns like "Fenergo"/"Azure" are what matter). Drop the
  // scaffolding words from the SUMMARY's hint contribution only; the user's own
  // typed context and explicit vocab hints are left untouched.
  const SCAFFOLD = new Set([
    'background', 'skill', 'skills', 'level', 'goals', 'goal', 'summary',
    'overview', 'experience', 'strengths', 'weaknesses', 'notes', 'relevant',
  ]);
  const dropScaffold = (s) =>
    flatten(s)
      .split(/\b/)
      .filter((tok) => !(/^[a-z]+$/i.test(tok) && SCAFFOLD.has(tok.toLowerCase())))
      .join('')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:!?])/g, '$1')
      .replace(/^[\s.,;:!?]+/, '')
      .trim();

  const vocabularyHints = () => {
    const settings = userSettingsStore.getCachedSettings();
    const sessionContext = settings.modeContext && settings.modeContext[settings.activeMode];
    // The uploaded document is where the domain's proper nouns actually live
    // (observed: "Fenergo" was in the resume, not the typed context — without
    // it Whisper heard "Vinnergo" while a competitor biased by the resume
    // heard it right). Feed a slice of its summary to Whisper too.
    const activeDoc = settings.documentContext && settings.documentContext[settings.activeMode];
    const docSummary = activeDoc && activeDoc.summary;

    // Auto-detect the interview's domain from the user's own context/résumé and
    // pre-seed the matching curated keyword bank (RAG, LLM, Kubernetes, KYC…) so
    // jargon is transcribed right at the source, no manual setup needed. Detection
    // runs over everything we know about this session.
    const detectContext = [settings.vocabularyHints, flatten(sessionContext), dropScaffold(docSummary)]
      .filter(Boolean)
      .join(' ');
    const { hint: keywordHint } = vocabularyBank.buildKeywordHint(detectContext);

    // Order by value: the user's own rare proper nouns first, then the curated
    // domain keywords, then trimmed slices of their context/doc for anything the
    // bank didn't cover — so if the cap does bite, it costs the least-valuable
    // tail rather than the user's own terms.
    const combined = [
      flatten(settings.vocabularyHints),
      keywordHint,
      flatten(sessionContext).slice(0, 240),
      dropScaffold(docSummary).slice(0, 180),
    ]
      .filter(Boolean)
      .join('. ');
    return combined ? combined.slice(0, HINT_MAX_CHARS) : null;
  };

  if (config.transcriptionProvider === 'backend') {
    return {
      transcribeFile: (filePath) =>
        backendProvider.transcribeFile(filePath, {
          backendUrl: config.backendUrl,
          vocabularyHints: vocabularyHints(),
        }),
    };
  }

  if (config.transcriptionProvider === 'groq') {
    return {
      transcribeFile: (filePath) =>
        groqProvider.transcribeFile(filePath, {
          apiKey: config.groqApiKey,
          model: config.groqSttModel,
          // Read live so a hint saved mid-session applies without a restart.
          vocabularyHints: vocabularyHints(),
        }),
    };
  }

  throw new Error(`Unknown TRANSCRIPTION_PROVIDER: ${config.transcriptionProvider}`);
}

module.exports = { createTranscriptionEngine };
