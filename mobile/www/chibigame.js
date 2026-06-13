// Comfort Match — a gentle chibi memory game. Flip cards, find the pairs.
// No timer pressure, no fail state; just a calming little win.

const CHIBIS = [
  { key: 'c1', label: 'Bear hoodie' },
  { key: 'c2', label: 'Kitty hoodie' },
  { key: 'c3', label: 'Bunny hoodie' },
  { key: 'c4', label: 'Mint bunny' },
  { key: 'c5', label: 'Puppy hoodie' },
  { key: 'c6', label: 'Bear cub' },
  { key: 'c7', label: 'Bunny pup' },
  { key: 'c8', label: 'Kitty cub' },
];

const WINLINES = [
  'You found them all. 🤍',
  'Every little one, matched. So gentle of you.',
  'All paired up. Take that softness with you.',
  'Done — and the room feels lighter, doesn\'t it?',
];

let mode = 'cozy';            // 'cozy' = 6 pairs, 'dreamy' = 8 pairs
let deck = [];               // [{ uid, key, label, matched }]
let flipped = [];            // uids currently face-up (max 2)
let lock = false;            // input lock during compare
let moves = 0;
let matched = 0;
let started = false;
let wired = false;

const $ = (s, r = document) => r.querySelector(s);
const root = () => document.getElementById('game-root');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const bestKey = (m) => `cg_best_${m}`;
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

// gentle WebAudio chime; silently no-ops if audio is unavailable
let actx = null;
function chime(freq = 660, dur = 0.18) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(); const g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    o.connect(g); g.connect(actx.destination);
    const t = actx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); o.stop(t + dur + 0.02);
  } catch (_) { /* no sound, no problem */ }
}

function newGame(m = mode) {
  mode = m;
  const pool = CHIBIS.slice(0, m === 'dreamy' ? 8 : 6);
  deck = shuffle(pool.flatMap((c, i) => [0, 1].map((n) => ({
    uid: `${c.key}_${n}`, key: c.key, label: c.label, matched: false,
  }))));
  flipped = []; lock = false; moves = 0; matched = 0; started = true;
  render();
}

function onCard(uid) {
  if (lock) return;
  const card = deck.find((c) => c.uid === uid);
  if (!card || card.matched || flipped.includes(uid)) return;
  flipped.push(uid);
  paintFlips();
  chime(620, 0.08);

  if (flipped.length === 2) {
    moves += 1;
    const [a, b] = flipped.map((u) => deck.find((c) => c.uid === u));
    if (a.key === b.key) {
      a.matched = b.matched = true; matched += 1; flipped = [];
      chime(880, 0.2);
      updateMeta();
      paintMatched();
      if (matched === deck.length / 2) setTimeout(win, 450);
    } else {
      lock = true;
      updateMeta();
      setTimeout(() => { flipped = []; lock = false; paintFlips(); }, 850);
    }
  }
}

function win() {
  const pairs = deck.length / 2;
  const key = bestKey(mode);
  const prev = parseInt(localStorage.getItem(key) || '0', 10);
  const isBest = !prev || moves < prev;
  if (isBest) localStorage.setItem(key, String(moves));
  const best = isBest ? moves : prev;
  const star = CHIBIS[Math.floor(Math.random() * pairs)];
  const line = WINLINES[Math.floor(Math.random() * WINLINES.length)];
  const ov = document.createElement('div');
  ov.className = 'cg-win';
  ov.innerHTML = `<div class="cg-win-card">
    <img src="assets/chibi/${star.key}.png" alt="" class="cg-win-img"/>
    <div class="cg-win-title">${esc(line)}</div>
    <div class="cg-win-stats">${moves} moves${isBest ? ' · new best! 🌟' : ` · best ${best}`}</div>
    <button class="btn btn-accent cg-again">Play again</button>
  </div>`;
  root().appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));
  ov.querySelector('.cg-again').addEventListener('click', () => { ov.remove(); newGame(); });
  ov.addEventListener('click', (e) => { if (e.target === ov) { ov.remove(); newGame(); } });
}

// ---- rendering ----
function paintFlips() {
  deck.forEach((c) => {
    const el = root().querySelector(`[data-uid="${c.uid}"]`);
    if (el) el.classList.toggle('flipped', c.matched || flipped.includes(c.uid));
  });
}
function paintMatched() {
  deck.forEach((c) => {
    if (!c.matched) return;
    const el = root().querySelector(`[data-uid="${c.uid}"]`);
    if (el && !el.classList.contains('matched')) { el.classList.add('matched'); el.disabled = true; }
  });
}
function updateMeta() {
  const m = $('#cg-moves'); if (m) m.textContent = `${moves} ${moves === 1 ? 'move' : 'moves'}`;
  const p = $('#cg-pairs'); if (p) p.textContent = `${matched} / ${deck.length / 2} pairs`;
}

function render() {
  const el = root();
  if (!el) return;
  const cols = mode === 'dreamy' ? 4 : 3;
  const best = parseInt(localStorage.getItem(bestKey(mode)) || '0', 10);
  const cards = deck.map((c) => `
    <button class="cg-card" data-uid="${c.uid}" aria-label="card" type="button">
      <span class="cg-face cg-back"></span>
      <span class="cg-face cg-front"><img src="assets/chibi/${c.key}.png" alt="${esc(c.label)}" draggable="false"/></span>
    </button>`).join('');
  el.innerHTML = `
    <div class="game-head">
      <div class="eyebrow">A soft little game</div>
      <h1 class="surface-title">Comfort Match</h1>
      <p class="surface-sub">Flip the cards two at a time and find each pair. No clock, no losing — just a gentle win.</p>
    </div>
    <div class="card cg-bar">
      <div class="cg-modes" role="group" aria-label="difficulty">
        <button class="cg-mode ${mode === 'cozy' ? 'on' : ''}" data-mode="cozy" type="button">Cozy · 6</button>
        <button class="cg-mode ${mode === 'dreamy' ? 'on' : ''}" data-mode="dreamy" type="button">Dreamy · 8</button>
      </div>
      <div class="cg-stats"><span id="cg-pairs">${matched} / ${deck.length / 2} pairs</span><span class="cg-dot">·</span><span id="cg-moves">${moves} ${moves === 1 ? 'move' : 'moves'}</span>${best ? `<span class="cg-dot">·</span><span>best ${best}</span>` : ''}</div>
      <button class="btn btn-ghost cg-new" type="button">New game</button>
    </div>
    <div class="cg-grid" style="grid-template-columns:repeat(${cols},1fr)">${cards}</div>`;
  paintFlips(); paintMatched();
}

function wire() {
  if (wired) return;
  wired = true;
  root().addEventListener('click', (ev) => {
    const card = ev.target.closest('.cg-card');
    if (card) { onCard(card.dataset.uid); return; }
    const modeBtn = ev.target.closest('.cg-mode');
    if (modeBtn) { newGame(modeBtn.dataset.mode); return; }
    if (ev.target.closest('.cg-new')) { newGame(); }
  });
}

export async function init() {
  wire();
  if (!started) newGame();
  else render();
}
