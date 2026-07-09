const { execFile } = require('child_process');

// ── Anti-proctoring guardrail ────────────────────────────────────────────────
// Confero must NEVER be usable to cheat on an online proctored exam (government
// or educational). This detects known proctoring / exam-lockdown software and,
// when present, the app disables capture + stealth and refuses to run.
//
// Best-effort by nature (no client check is 100% un-evadable), but on by default
// and re-checked periodically during a session. Matching is on lowercased
// process names using specific tokens chosen to avoid false positives.
const BLOCKED_PROCESS_TOKENS = [
  'lockdownbrowser',      // Respondus LockDown Browser
  'responduslockdown',
  'examplify',            // ExamSoft Examplify
  'examsoft',
  'onvue',                // Pearson VUE OnVUE
  'safeexambrowser',      // Safe Exam Browser (SEB)
  'guardianbrowser',      // ProctorU Guardian
  'proctortrack',         // Verificient Proctortrack
  'proctorio',            // Proctorio
  'proctoru',
  'meazure',              // Meazure Learning / ProctorU
  'honorlock',
  'examity',
  'talview',
  'mettl',                // Mercer Mettl
  'kryterion',
  'examroom',
  'autoproctor',
  'prometric',
  'sumadi',
  'smowl',
];

function listProcesses() {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // /fo csv gives one quoted image name per line; /nh strips the header.
      execFile('tasklist', ['/fo', 'csv', '/nh'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        const names = stdout
          .split(/\r?\n/)
          .map((line) => (line.match(/^"([^"]+)"/) || [])[1])
          .filter(Boolean);
        resolve(names);
      });
    } else {
      // macOS / Linux
      execFile('ps', ['-axco', 'command'], { maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
        if (err || !stdout) return resolve([]);
        resolve(stdout.split(/\r?\n/).filter(Boolean));
      });
    }
  });
}

// Returns the name of a detected proctoring app, or null if the coast is clear.
async function detectProctoring() {
  const procs = await listProcesses();
  const lowered = procs.map((p) => p.toLowerCase());
  for (const token of BLOCKED_PROCESS_TOKENS) {
    const hit = lowered.find((p) => p.includes(token));
    if (hit) return hit;
  }
  return null;
}

module.exports = { detectProctoring, BLOCKED_PROCESS_TOKENS };
