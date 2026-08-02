const steps = Array.from(document.querySelectorAll('.step'));
const dots = Array.from(document.querySelectorAll('.steps-indicator .dot'));
const closeBtn = document.getElementById('closeBtn');
const signinBtn = document.getElementById('signinBtn');
const signinStatus = document.getElementById('signinStatus');
const launchBtn = document.getElementById('launchBtn');
const personaList = document.getElementById('personaList');
const testMicBtn = document.getElementById('testMicBtn');
const skipMicBtn = document.getElementById('skipMicBtn');
const micLevel = document.getElementById('micLevel');
const micStatus = document.getElementById('micStatus');

// Steps: 0 Welcome · 1 Persona · 2 Sign in · 3 Test mic · 4 Done
let current = 0;

function goToStep(index) {
  current = index;
  steps.forEach((s, i) => s.classList.toggle('step-active', i === index));
  dots.forEach((d, i) => d.classList.toggle('dot-active', i === index));
}

document.querySelectorAll('[data-next]').forEach((btn) =>
  btn.addEventListener('click', () => goToStep(current + 1))
);
document.querySelectorAll('[data-back]').forEach((btn) =>
  btn.addEventListener('click', () => goToStep(current - 1))
);

closeBtn.addEventListener('click', () => window.stealthAPI.closeApp());

// ── Persona step → sets the default Mode ──
async function initPersona() {
  const modes = await window.stealthAPI.listModes();
  const active = await window.stealthAPI.getActiveMode();
  personaList.innerHTML = modes.map((m) => `
    <button class="persona ${m.id === active ? 'sel' : ''}" data-id="${m.id}">
      <span class="p-emoji">${m.emoji}</span>
      <span class="p-text"><span class="p-label">${m.label}</span><span class="p-blurb">${m.blurb}</span></span>
      <svg class="p-arrow" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4l4 4-4 4"/></svg>
    </button>`).join('');
  personaList.querySelectorAll('.persona').forEach((el) => {
    el.addEventListener('click', async () => {
      await window.stealthAPI.setActiveMode(el.getAttribute('data-id'));
      personaList.querySelectorAll('.persona').forEach((p) => p.classList.remove('sel'));
      el.classList.add('sel');
      setTimeout(() => goToStep(2), 220);
    });
  });
}
initPersona();

// ── Sign in ──
function setStatus(text, kind) {
  signinStatus.textContent = text;
  signinStatus.className = `key-status ${kind || ''}`;
}

// Main reports "Waking the server…" while it absorbs a sleeping backend's cold
// start, so the browser only opens once the real sign-in page will answer.
window.stealthAPI.onSigninStatus(({ text }) => {
  if (!text) return;
  signinBtn.textContent = text;
  setStatus('The server was asleep — giving it a moment so sign-in opens properly.', '');
});

signinBtn.addEventListener('click', async () => {
  signinBtn.disabled = true;
  signinBtn.textContent = 'Waiting for browser...';
  setStatus('Complete sign-in in the browser window that just opened.', '');
  try {
    const result = await window.stealthAPI.startSignin();
    if (result.ok) {
      setStatus('Signed in.', 'ok');
      setTimeout(() => goToStep(3), 400);
    } else {
      setStatus(result.error || "Sign-in didn't complete. Please try again.", 'err');
    }
  } catch (err) {
    setStatus(`Couldn't sign in: ${err.message}`, 'err');
  } finally {
    signinBtn.disabled = false;
    signinBtn.textContent = 'Sign in / Create account';
  }
});

// ── Test microphone (renderer-only; getUserMedia + live level meter) ──
let micStream = null;
let micRaf = null;
skipMicBtn.addEventListener('click', () => { stopMicTest(); goToStep(4); });

function stopMicTest() {
  if (micRaf) cancelAnimationFrame(micRaf);
  if (micStream) micStream.getTracks().forEach((t) => t.stop());
  micStream = null;
}

testMicBtn.addEventListener('click', async () => {
  testMicBtn.disabled = true;
  micStatus.textContent = 'Listening... say something!';
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new AudioContext();
    const src = ctx.createMediaStreamSource(micStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let heard = false;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i] - 128));
      const pct = Math.min(100, (peak / 60) * 100);
      micLevel.style.width = `${pct}%`;
      if (pct > 25 && !heard) {
        heard = true;
        micStatus.textContent = "Perfect — I can hear you! ✓";
        micStatus.classList.add('ok');
        testMicBtn.textContent = 'Continue';
        testMicBtn.disabled = false;
        testMicBtn.onclick = () => { stopMicTest(); goToStep(4); };
      }
      micRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    micStatus.textContent = `Couldn't access the mic: ${err.message}`;
    micStatus.classList.add('err');
    testMicBtn.disabled = false;
  }
});

launchBtn.addEventListener('click', () => { stopMicTest(); window.stealthAPI.completeOnboarding(); });
