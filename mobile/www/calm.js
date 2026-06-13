// Calm Space — soothing procedural sound, a chakra reset, and a chibi to
// breathe with. All client-side: no assets, no network. Renders into
// #calm-root. Audio is generated with the Web Audio API so there are no
// music files to ship or license.

const $ = (s, r = document) => r.querySelector(s);
let wired = false;

// ---------------------------------------------------------------------------
// Sound engine — procedural ambient scenes via Web Audio.
// ---------------------------------------------------------------------------
const Audio = {
  ctx: null,
  master: null,
  scene: null,      // { stop() } for the active ambient scene
  sceneName: null,
  ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
  },
  resume() { this.ensure(); if (this.ctx.state === 'suspended') this.ctx.resume(); },
  setVolume(v) { this.ensure(); this.master.gain.value = v; },

  noiseBuffer(kind = 'white') {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return buf;
  },

  playScene(name) {
    this.resume();
    this.stopScene();
    const t = this.ctx.currentTime;
    const out = this.ctx.createGain();
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(1, t + 1.5);   // gentle fade-in
    out.connect(this.master);
    const nodes = [];

    if (name === 'deepcalm') {
      [110, 164.81, 220].forEach((f, i) => {
        const o = this.ctx.createOscillator();
        o.type = 'sine'; o.frequency.value = f;
        const g = this.ctx.createGain(); g.gain.value = i === 0 ? 0.5 : 0.22;
        o.connect(g); g.connect(out); o.start(); nodes.push(o);
      });
      // slow breathing swell
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.08;
      const lg = this.ctx.createGain(); lg.gain.value = 0.25;
      lfo.connect(lg); lg.connect(out.gain); lfo.start(); nodes.push(lfo);
    } else if (name === 'rain') {
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer('white'); src.loop = true;
      const bp = this.ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 0.6;
      const g = this.ctx.createGain(); g.gain.value = 0.4;
      src.connect(bp); bp.connect(g); g.connect(out); src.start(); nodes.push(src);
    } else if (name === 'ocean') {
      const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer('brown'); src.loop = true;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      const g = this.ctx.createGain(); g.gain.value = 0.5;
      src.connect(lp); lp.connect(g); g.connect(out); src.start(); nodes.push(src);
      // waves: sweep the filter slowly
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.1;
      const lg = this.ctx.createGain(); lg.gain.value = 380;
      lfo.connect(lg); lg.connect(lp.frequency); lfo.start(); nodes.push(lfo);
    } else if (name === 'bowl') {
      [432, 648, 864].forEach((f, i) => {
        const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const g = this.ctx.createGain(); g.gain.value = i === 0 ? 0.4 : 0.15;
        o.connect(g); g.connect(out); o.start(); nodes.push(o);
      });
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.15;
      const lg = this.ctx.createGain(); lg.gain.value = 0.18;
      lfo.connect(lg); lg.connect(out.gain); lfo.start(); nodes.push(lfo);
    }

    this.sceneName = name;
    this.scene = {
      stop: () => {
        const now = this.ctx.currentTime;
        out.gain.cancelScheduledValues(now);
        out.gain.setValueAtTime(out.gain.value, now);
        out.gain.linearRampToValueAtTime(0, now + 0.8);
        nodes.forEach((n) => { try { n.stop(now + 0.9); } catch {} });
      },
    };
  },

  stopScene() {
    if (this.scene) { this.scene.stop(); this.scene = null; this.sceneName = null; }
  },

  // A soft, plucked tone for chakra notes — quick attack, long gentle release.
  tone(freq, dur = 3) {
    this.resume();
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const o2 = this.ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const g2 = this.ctx.createGain(); g2.gain.value = 0.18;
    o2.connect(g2); g2.connect(g); o.connect(g); g.connect(this.master);
    o.start(t); o2.start(t); o.stop(t + dur); o2.stop(t + dur);
  },
};

const SCENES = [
  { id: 'deepcalm', label: 'Deep Calm', emoji: '🌙' },
  { id: 'rain',     label: 'Soft Rain', emoji: '🌧️' },
  { id: 'ocean',    label: 'Ocean',     emoji: '🌊' },
  { id: 'bowl',     label: 'Singing Bowl', emoji: '🔔' },
];

// ---------------------------------------------------------------------------
// Chakras
// ---------------------------------------------------------------------------
const CHAKRAS = [
  { key: 'crown',   name: 'Crown',        sanskrit: 'Sahasrara',  color: '#9b5de5', freq: 963, aff: 'I am connected to something larger than this pain.' },
  { key: 'thirdeye',name: 'Third Eye',    sanskrit: 'Ajna',       color: '#5e60ce', freq: 852, aff: 'I trust what I know. I can see clearly.' },
  { key: 'throat',  name: 'Throat',       sanskrit: 'Vishuddha',  color: '#4ea8de', freq: 741, aff: 'I speak my truth, even the unsent words.' },
  { key: 'heart',   name: 'Heart',        sanskrit: 'Anahata',    color: '#52b788', freq: 639, aff: 'My heart is healing. I can love again.' },
  { key: 'solar',   name: 'Solar Plexus', sanskrit: 'Manipura',   color: '#f4d35e', freq: 528, aff: 'I am strong enough to carry this and keep going.' },
  { key: 'sacral',  name: 'Sacral',       sanskrit: 'Svadhisthana',color: '#f3722c', freq: 417, aff: 'I let feelings move through me without fear.' },
  { key: 'root',    name: 'Root',         sanskrit: 'Muladhara',  color: '#e63946', freq: 396, aff: 'I am safe. I am grounded. I belong here.' },
];
let journeyTimer = null;

function chakraColumn() {
  return CHAKRAS.map((c, i) =>
    `<button class="chakra" data-chakra="${i}" style="--cc:${c.color}">
      <span class="chakra-dot"></span>
      <span class="chakra-name">${c.name}<small>${c.sanskrit} · ${c.freq}Hz</small></span>
    </button>`).join('');
}
function activateChakra(i) {
  const c = CHAKRAS[i];
  Audio.tone(c.freq, 3.2);
  document.querySelectorAll('.chakra').forEach((el, idx) => el.classList.toggle('lit', idx === i));
  const aff = $('#chakra-aff');
  if (aff) { aff.textContent = `"${c.aff}"`; aff.style.color = c.color; }
}
function stopJourney() {
  if (journeyTimer) { clearTimeout(journeyTimer); journeyTimer = null; }
  document.querySelectorAll('.chakra').forEach((el) => el.classList.remove('lit'));
  const b = $('#chakra-journey'); if (b) b.textContent = 'Guided journey ↑';
}
function startJourney() {
  stopJourney();
  const b = $('#chakra-journey'); if (b) b.textContent = 'Stop journey';
  let i = CHAKRAS.length - 1;   // begin at the root, rise to the crown
  const step = () => {
    if (i < 0) { stopJourney(); const a = $('#chakra-aff'); if (a) a.textContent = 'Aligned. Breathe.'; return; }
    activateChakra(i);
    i -= 1;
    journeyTimer = setTimeout(step, 3400);
  };
  step();
}

// ---------------------------------------------------------------------------
// Breathe-with-chibi game
// ---------------------------------------------------------------------------
const BREATH = [
  { name: 'Breathe in', secs: 4, scale: 1.5 },
  { name: 'Hold',       secs: 4, scale: 1.5 },
  { name: 'Breathe out',secs: 6, scale: 1.0 },
];
let breathing = false, breathPhase = 0, breathCycles = 0, breathTimer = null;

function chibiSvg(mood = 'calm') {
  // mood: 'calm' | 'happy' | 'bliss'. A manhwa-style chibi in a grey cat
  // hoodie with big teal eyes — drawn in SVG so it animates instantly and
  // stays symbolic (no realistic photos).
  const OUT = '#4a3a2e', HAIR = '#7a4f33', HAIRH = '#a9794f', BLUSH = '#f4a0a0', HOODIN = '#f3aebf';
  let eyes, mouth;
  if (mood === 'bliss') {
    eyes = '<path d="M40 88 q12 -15 24 0" stroke="#2a211c" stroke-width="4.5" fill="none" stroke-linecap="round"/>'
         + '<path d="M78 88 q12 -15 24 0" stroke="#2a211c" stroke-width="4.5" fill="none" stroke-linecap="round"/>';
    mouth = '<ellipse cx="71" cy="106" rx="6" ry="5" fill="#c65b48"/><path d="M65 104 q6 7 12 0" fill="#ef9d84"/>';
  } else {
    const eye = (cx) =>
      `<ellipse cx="${cx}" cy="90" rx="14" ry="18" fill="#fff" stroke="${OUT}" stroke-width="1.2"/>
       <ellipse cx="${cx}" cy="92" rx="12.5" ry="16" fill="url(#ci_iris)"/>
       <ellipse cx="${cx}" cy="98" rx="9" ry="11" fill="url(#ci_irisd)" opacity="0.7"/>
       <circle cx="${cx}" cy="93" r="5.5" fill="#15302c"/>
       <circle cx="${cx - 5}" cy="84" r="5" fill="#fff"/>
       <circle cx="${cx + 5}" cy="98" r="3" fill="#fff" opacity="0.9"/>
       <circle cx="${cx - 6}" cy="95" r="1.6" fill="#cffaf2" opacity="0.9"/>
       <path d="M${cx - 16} 75 q16 -10 32 0" stroke="#2a211c" stroke-width="5" fill="none" stroke-linecap="round"/>`;
    eyes = eye(50) + eye(92);
    mouth = mood === 'calm'
      ? '<path d="M65 107 q6 5 12 0" stroke="#b15b48" stroke-width="3" fill="none" stroke-linecap="round"/>'
      : '<path d="M62 104 q9 10 18 0 q-9 4 -18 0z" fill="#c65b48"/><path d="M64 105 q7 3 14 0" fill="#ef9d84"/>';
  }
  return `<svg viewBox="0 0 144 176" class="chibi-svg" aria-hidden="true">
    <defs>
      <radialGradient id="ci_iris" cx="50%" cy="30%" r="75%">
        <stop offset="0%" stop-color="#aef0e4"/><stop offset="50%" stop-color="#3fb9a5"/><stop offset="100%" stop-color="#1f7d6e"/></radialGradient>
      <radialGradient id="ci_irisd" cx="50%" cy="80%" r="70%">
        <stop offset="0%" stop-color="#1f7d6e"/><stop offset="100%" stop-color="#11514a"/></radialGradient>
      <linearGradient id="ci_hair" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${HAIRH}"/><stop offset="100%" stop-color="${HAIR}"/></linearGradient>
      <linearGradient id="ci_hood" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#d3d7de"/><stop offset="100%" stop-color="#c2c7cf"/></linearGradient>
    </defs>
    <ellipse cx="72" cy="168" rx="36" ry="5" fill="#000" opacity="0.08"/>
    <path d="M44 162 q-4 -34 28 -34 q32 0 28 34 z" fill="url(#ci_hood)" stroke="${OUT}" stroke-width="1.3"/>
    <ellipse cx="56" cy="150" rx="6" ry="7" fill="#fff" opacity="0.8"/><ellipse cx="88" cy="150" rx="6" ry="7" fill="#fff" opacity="0.8"/>
    <path d="M26 44 L20 12 L52 34 Z" fill="url(#ci_hood)" stroke="${OUT}" stroke-width="1.3"/>
    <path d="M30 38 L26 20 L44 33 Z" fill="${HOODIN}"/>
    <path d="M118 44 L124 12 L92 34 Z" fill="url(#ci_hood)" stroke="${OUT}" stroke-width="1.3"/>
    <path d="M114 38 L118 20 L100 33 Z" fill="${HOODIN}"/>
    <ellipse cx="72" cy="82" rx="64" ry="62" fill="url(#ci_hood)" stroke="${OUT}" stroke-width="1.4"/>
    <ellipse cx="72" cy="40" rx="15" ry="11" fill="#fff"/>
    <circle cx="66" cy="39" r="1.8" fill="#3a2f28"/><circle cx="78" cy="39" r="1.8" fill="#3a2f28"/>
    <path d="M70 43 q2 2 4 0" stroke="#d98fa3" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    <path d="M16 84 Q10 130 30 150 Q26 110 30 86 Z" fill="url(#ci_hair)"/>
    <path d="M128 84 Q134 130 114 150 Q118 110 114 86 Z" fill="url(#ci_hair)"/>
    <ellipse cx="72" cy="86" rx="50" ry="48" fill="var(--aria-skin,#fde8d6)" stroke="${OUT}" stroke-width="1.3"/>
    <ellipse cx="72" cy="98" rx="50" ry="36" fill="#f4d2bd" opacity="0.30"/>
    <path d="M22 70 Q16 104 26 124 Q34 104 30 82 Q40 74 46 70 Q30 64 22 70Z" fill="url(#ci_hair)" stroke="${OUT}" stroke-width="1.2"/>
    <path d="M122 70 Q128 104 118 124 Q110 104 114 82 Q104 74 98 70 Q114 64 122 70Z" fill="url(#ci_hair)" stroke="${OUT}" stroke-width="1.2"/>
    <path d="M24 78 Q22 36 72 30 Q122 36 120 78 Q113 60 100 66 Q95 46 80 58 Q76 42 64 54 Q56 44 50 60 Q36 50 33 68 Q28 62 24 78 Z" fill="url(#ci_hair)" stroke="${OUT}" stroke-width="1.3"/>
    <path d="M44 40 Q62 30 84 36" stroke="${HAIRH}" stroke-width="4" fill="none" stroke-linecap="round" opacity="0.85"/>
    <path d="M30 60 Q34 48 44 44" stroke="${HAIRH}" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.6"/>
    <ellipse cx="40" cy="104" rx="9" ry="5.5" fill="${BLUSH}" opacity="0.55"/>
    <ellipse cx="104" cy="104" rx="9" ry="5.5" fill="${BLUSH}" opacity="0.55"/>
    <circle cx="72" cy="101" r="1.6" fill="#e0ac92"/>
    ${eyes}${mouth}
  </svg>`;
}
function chibiMood() {
  if (breathCycles >= 6) return 'bliss';
  if (breathCycles >= 3) return 'happy';
  return 'calm';
}
function setBreathUI(phase) {
  const orb = $('#breath-orb'); const cue = $('#breath-cue'); const sub = $('#breath-sub');
  if (!orb) return;
  const p = BREATH[phase];
  orb.style.transition = `transform ${p.secs}s ease-in-out`;
  orb.style.transform = `scale(${p.scale})`;
  if (cue) cue.textContent = p.name;
  if (sub) sub.textContent = `${breathCycles} calm ${breathCycles === 1 ? 'breath' : 'breaths'}`;
  const fig = $('#chibi-fig'); if (fig) fig.innerHTML = chibiSvg(chibiMood());
}
function breathStep() {
  if (!breathing) return;
  setBreathUI(breathPhase);
  const secs = BREATH[breathPhase].secs;
  breathTimer = setTimeout(() => {
    breathPhase = (breathPhase + 1) % BREATH.length;
    if (breathPhase === 0) { breathCycles += 1; }
    breathStep();
  }, secs * 1000);
}
function startBreathing() {
  if (breathing) return;
  breathing = true; breathPhase = 0;
  const b = $('#breath-toggle'); if (b) b.textContent = 'Stop';
  breathStep();
}
function stopBreathing() {
  breathing = false;
  if (breathTimer) { clearTimeout(breathTimer); breathTimer = null; }
  const orb = $('#breath-orb'); if (orb) { orb.style.transition = 'transform 1s ease'; orb.style.transform = 'scale(1)'; }
  const cue = $('#breath-cue'); if (cue) cue.textContent = 'Tap to begin';
  const b = $('#breath-toggle'); if (b) b.textContent = 'Begin';
}

// ---------------------------------------------------------------------------
// Render + wiring
// ---------------------------------------------------------------------------
function render() {
  const el = $('#calm-root');
  if (!el) return;
  el.innerHTML = `
    <div class="card calm-card">
      <h3 class="calm-h">Soothing sound</h3>
      <p class="calm-hint">Generated live — pick a scene to wrap the room in.</p>
      <div class="scene-row">${SCENES.map((s) => `<button class="scene-btn" data-scene="${s.id}"><span class="scene-emoji">${s.emoji}</span>${s.label}</button>`).join('')}</div>
      <div class="calm-vol"><span>🔈</span><input id="calm-volume" type="range" min="0" max="1" step="0.01" value="0.5"/><span>🔊</span></div>
    </div>

    <div class="card calm-card">
      <h3 class="calm-h">Chakra reset</h3>
      <p class="calm-hint">Tap a center to sound its note, or take the guided journey from root to crown.</p>
      <div class="chakra-wrap">
        <div class="chakra-col">${chakraColumn()}</div>
        <div class="chakra-side">
          <button class="btn btn-accent calm-w" id="chakra-journey">Guided journey ↑</button>
          <p id="chakra-aff" class="chakra-aff">Tap a chakra to begin.</p>
        </div>
      </div>
    </div>

    <div class="card calm-card breath-card">
      <h3 class="calm-h">Breathe with me</h3>
      <p class="calm-hint">Follow the circle. In for 4, hold 4, out for 6.</p>
      <div class="breath-stage">
        <div class="breath-orb" id="breath-orb">
          <div class="chibi-fig" id="chibi-fig">${chibiSvg('calm')}</div>
        </div>
      </div>
      <div class="breath-cue" id="breath-cue">Tap to begin</div>
      <div class="breath-sub" id="breath-sub">0 calm breaths</div>
      <button class="btn btn-accent calm-w" id="breath-toggle">Begin</button>
    </div>
  `;
}

function wire() {
  if (wired) return;
  wired = true;
  const el = $('#calm-root');

  el.addEventListener('click', (ev) => {
    const scene = ev.target.closest('[data-scene]');
    if (scene) {
      const id = scene.dataset.scene;
      const wasOn = Audio.sceneName === id;
      Audio.stopScene();
      document.querySelectorAll('.scene-btn').forEach((b) => b.classList.remove('on'));
      if (!wasOn) { Audio.playScene(id); scene.classList.add('on'); }
      return;
    }
    const ch = ev.target.closest('[data-chakra]');
    if (ch) { stopJourney(); activateChakra(parseInt(ch.dataset.chakra, 10)); return; }
    if (ev.target.closest('#chakra-journey')) {
      if (journeyTimer) stopJourney(); else startJourney();
      return;
    }
    if (ev.target.closest('#breath-toggle') || ev.target.closest('#breath-orb')) {
      if (breathing) stopBreathing(); else startBreathing();
      return;
    }
  });

  el.addEventListener('input', (ev) => {
    if (ev.target.id === 'calm-volume') Audio.setVolume(parseFloat(ev.target.value));
  });
}

export async function init() {
  render();
  wire();
}

// When leaving the tab, hush everything. app.js toggles .surface.active.
document.addEventListener('click', (ev) => {
  const nav = ev.target.closest('.nav-item');
  if (nav && nav.dataset.surface !== 'calm') {
    Audio.stopScene();
    document.querySelectorAll('.scene-btn').forEach((b) => b.classList.remove('on'));
    stopJourney();
    stopBreathing();
  }
});
