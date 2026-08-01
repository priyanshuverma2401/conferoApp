// ── Summary shape repair, shared by both windows ──
// Loaded as a plain script by the overlay (past-session viewer) AND by the
// full-screen session report, which render the same summary in different markup
// — so the PARSER lives here and each page does its own HTML.
//
// The summary is asked for as plain text with ALL-CAPS section headings and "-"
// bullets (see buildSessionSummaryPrompt), but the free-tier models we fall back
// to drop that shape under load — they answer in markdown, or in one prose blob.
// A wall of prose is useless as minutes, so this parser REPAIRS the shape rather
// than passing it through: it recognises the heading/bullet forms models
// actually emit, and splits prose that landed in a bullet section into one
// bullet per sentence.
(function (global) {
  // The headings we ask for, across all modes (SUMMARY_SHAPES) — matched so a
  // heading is still recognised when a model writes it in Title Case.
  const SUMMARY_HEADINGS = new Set([
    'OVERVIEW', 'SUMMARY', 'KEY POINTS', 'DECISIONS', 'DECISIONS & CONCLUSIONS',
    'ACTION ITEMS & NEXT STEPS', 'ACTION ITEMS', 'NEXT STEPS',
    'QUESTIONS & HOW THEY WERE ANSWERED', 'PROBLEMS & APPROACHES', 'WHAT WAS COVERED',
  ]);
  const BULLET_RE = /^\s*(?:[-–—•*‣]|\d+[.)])\s+/;

  // Longest-first so "ACTION ITEMS & NEXT STEPS" wins over "ACTION ITEMS".
  const HEADINGS_ALT = [...SUMMARY_HEADINGS]
    .sort((a, b) => b.length - a.length)
    .map((h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  // Case-SENSITIVE on purpose: only the ALL-CAPS form is a heading here, so "key
  // points were raised" in a sentence is never treated as a section break. The
  // lookbehind stops "ACTION ITEMS & NEXT STEPS" from being cut in half at its
  // own conjunction — "NEXT STEPS" is also a heading in its own right.
  const INLINE_HEADING_RE = new RegExp(`(?<![&+])\\s+(?=(?:${HEADINGS_ALT})\\b)`, 'g');
  // Same conjunction guard: without the (?![&+]) the alternation backtracks to the
  // short "ACTION ITEMS" and breaks the line at "& NEXT STEPS".
  const OWN_LINE_HEADING_RE = new RegExp(`^(${HEADINGS_ALT})[ \\t]*:?[ \\t]+(?![&+])(?=\\S)`, 'gm');
  // A collapsed list separates its items with ". - ", never a bare " - ": the
  // sentence punctuation is what tells a run-on bullet list apart from a dash
  // used as punctuation ("the client - who joined late - agreed").
  const INLINE_BULLET_RE = /(?<=[.;:!?])\s+[-•]\s+/g;

  // The worst real failure: a weak model returns the whole summary on ONE physical
  // line — "OVERVIEW ... KEY POINTS - a. - b. - c." — which is exactly the "it's
  // just one paragraph" complaint. Put the line breaks back before anything is
  // parsed or copied. Idempotent, so a well-formed summary passes through untouched.
  function normalizeSummary(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!t) return '';
    return t
      .replace(INLINE_HEADING_RE, '\n')
      .replace(OWN_LINE_HEADING_RE, '$1\n')
      .split('\n')
      .map((line) => line.replace(INLINE_BULLET_RE, '\n- '))
      .join('\n');
  }

  // Models emit **bold** headings and `#` headings despite "no markdown".
  function stripMd(line) {
    return line
      .replace(/^\s*#{1,6}\s+/, '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/__(.+?)__/g, '$1')
      .replace(/`/g, '')
      .trim();
  }

  // Returns the canonical heading, or null if this line is body text.
  function summaryHeading(line) {
    const t = line.replace(/[:：]\s*$/, '').trim();
    if (!t || t.length > 52 || BULLET_RE.test(line)) return null;
    if (/^[A-Z][A-Z0-9 &/'’,.\-]{2,}$/.test(t) && !/[.!?]$/.test(t)) return t.toUpperCase();
    return SUMMARY_HEADINGS.has(t.toUpperCase()) ? t.toUpperCase() : null;
  }

  // Split a prose run into sentences so it can be re-bulleted. Only breaks on
  // terminal punctuation followed by a capital, so "3.4 seconds" and "p99." stay put.
  function sentences(text) {
    return text
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+(?=["'(]?[A-Z0-9])/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // → [{ head: 'KEY POINTS' | null, blocks: [{ type: 'bullet' | 'p', text }] }]
  function parseSummary(text) {
    const lines = normalizeSummary(text).split('\n').map(stripMd).filter(Boolean);
    // Group into sections first — whether a stray prose line is legitimate
    // (OVERVIEW) or a formatting failure (a bullet section) depends on its heading.
    const sections = [];
    let cur = { head: null, body: [] };
    for (const line of lines) {
      const h = summaryHeading(line);
      if (h) {
        if (cur.head || cur.body.length) sections.push(cur);
        cur = { head: h, body: [] };
      } else {
        cur.body.push(line);
      }
    }
    if (cur.head || cur.body.length) sections.push(cur);

    // Worst case: the model ignored the format completely and sent back a blob.
    // Bullet the sentences rather than reprinting the paragraph.
    const unstructured = !sections.some((s) => s.head)
      && !sections.some((s) => s.body.some((l) => BULLET_RE.test(l)));

    return sections.map((s) => {
      const blocks = [];
      // OVERVIEW is meant to be sentences; everything else is a bullet section.
      const proseOk = s.head ? /^(OVERVIEW|SUMMARY)$/.test(s.head) : !unstructured;
      for (const line of s.body) {
        if (BULLET_RE.test(line)) blocks.push({ type: 'bullet', text: line.replace(BULLET_RE, '') });
        else if (proseOk) blocks.push({ type: 'p', text: line });
        else sentences(line).forEach((sn) => blocks.push({ type: 'bullet', text: sn }));
      }
      return { head: s.head, blocks };
    });
  }

  global.SummaryFormat = { normalizeSummary, parseSummary };
}(window));
