// Onboarding flow — shown the first time the user opens the app.
// 4 steps: name → mascot → purpose → mood. Persists to settings.
//
// Communication with app.js:
//   - reads window.state, window.mascot, window.api, window.toast, window.renderChat
//   - listens to 'aria:settings-updated' event from the Account tab
//   - emits 'onboarding:complete' after success

const MASCOTS = [
  { id: 'crane',   label: 'Crane' },
  { id: 'moon',    label: 'Moon' },
  { id: 'feather', label: 'Feather' },
  { id: 'leaf',    label: 'Leaf' },
  { id: 'wave',    label: 'Wave' },
  { id: 'sprout',  label: 'Sprout' },
];

let step = 1;
let data = { name: '', mascot: 'crane', purpose: null, mood: null };

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

// fallback mascot SVGs in case window.mascot hasn't loaded yet
const FALLBACK_SVG = {
  crane:   '<svg viewBox="0 0 80 80"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 55 Q15 35 30 25 Q40 18 55 22 L62 18"/><path d="M30 25 Q40 40 55 22"/><path d="M20 55 L35 45 L45 55 Z" fill="currentColor" fill-opacity="0.2"/><circle cx="60" cy="19" r="1.5" fill="currentColor"/></g></svg>',
  moon:    '<svg viewBox="0 0 80 80"><path d="M50 18 A26 26 0 1 0 62 50 A20 20 0 0 1 50 18 Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2"/></svg>',
  feather: '<svg viewBox="0 0 80 80"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M58 16 Q35 25 25 50 Q22 60 26 66 Q40 60 52 42 Q60 30 60 18 Z" fill="currentColor" fill-opacity="0.2"/></g></svg>',
  leaf:    '<svg viewBox="0 0 80 80"><path d="M18 56 Q22 28 56 18 Q52 52 22 60 Z" fill="currentColor" fill-opacity="0.2" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  wave:    '<svg viewBox="0 0 80 80"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 30 Q26 22 38 30 T62 30"/><path d="M14 42 Q26 34 38 42 T62 42"/><path d="M14 54 Q26 46 38 54 T62 54"/></g></svg>',
  sprout:  '<svg viewBox="0 0 80 80"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M40 64 L40 36"/><path d="M40 40 Q30 30 22 30 Q24 40 40 42"/><path d="M40 36 Q50 26 58 26 Q56 36 40 38"/></g></svg>',
};
function svgFor(id) {
  try {
    if (typeof window.mascot === 'function') return window.mascot(id, true);
  } catch (e) { /* fall through */ }
  return FALLBACK_SVG[id] || FALLBACK_SVG.crane;
}

function show(n) {
  step = n;
  $$('.onboard-step').forEach(el => el.hidden = (+el.dataset.step !== n));
  $$('.onboard-progress .dot').forEach((d, i) => {
    d.classList.toggle('active', i + 1 <= n);
  });
  if (n === 2) renderMascotGrid();
  if (n === 4) renderMoodRow();
  updateButtonState();
}

function updateButtonState() {
  // enable Begin only when a mood is picked (or no mood available)
  const finish = $('#ob-finish');
  if (finish) finish.disabled = !data.mood;
}

function renderMascotGrid() {
  const grid = $('#ob-mascots');
  if (!grid) return;
  if (!grid.dataset.loaded) {
    grid.innerHTML = MASCOTS.map(m => `
      <button class="mascot-pick ${data.mascot === m.id ? 'picked' : ''}" data-m="${m.id}" type="button">
        <span data-mascot-slot="${m.id}" class="mascot-slot"></span>
        <span class="label">${m.label}</span>
      </button>
    `).join('');
    grid.dataset.loaded = '1';
    grid.addEventListener('click', e => {
      const btn = e.target.closest('.mascot-pick');
      if (!btn) return;
      data.mascot = btn.dataset.m;
      $$('.mascot-pick', grid).forEach(c => c.classList.toggle('picked', c === btn));
    });
  }
  // (re)inject SVGs every time we show this step — the window.mascot fn may
  // not have been ready the first time we visited.
  MASCOTS.forEach(m => {
    const slot = grid.querySelector(`[data-mascot-slot="${m.id}"]`);
    if (slot) slot.innerHTML = svgFor(m.id);
  });
}

function renderMoodRow() {
  const row = $('#ob-moods');
  if (!row) return;
  if (!row.dataset.loaded) {
    const moods = (window.state && Array.isArray(window.state.moods)) ? window.state.moods : [];
    if (moods.length === 0) {
      row.innerHTML = '<p class="onboard-sub" style="text-align:center">No moods loaded yet. You can pick a default below.</p>';
    } else {
      row.innerHTML = moods.map(m => `
        <button class="mood-pick ${data.mood === m.id ? 'picked' : ''}" data-id="${m.id}" type="button">
          <span class="em">${m.emoji || '·'}</span>
          <span>${m.name || m.id}</span>
        </button>
      `).join('');
      row.dataset.loaded = '1';
      row.addEventListener('click', e => {
        const btn = e.target.closest('.mood-pick');
        if (!btn) return;
        data.mood = btn.dataset.id;
        $$('.mood-pick', row).forEach(c => c.classList.toggle('picked', c === btn));
        updateButtonState();
      });
    }
  }
  updateButtonState();
}

function wireNav() {
  const root = $('#onboarding');
  if (!root || root.dataset.wired) return;
  root.dataset.wired = '1';

  $('#ob-name').addEventListener('input', e => { data.name = e.target.value.trim(); });
  $('#ob-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('#ob-next-1').click(); });

  $('#ob-next-1').addEventListener('click', () => {
    if (!data.name) { window.toast && window.toast('A name (or nickname) helps me greet you.'); return; }
    show(2);
  });
  $('#ob-next-2').addEventListener('click', () => show(3));
  $('#ob-next-3').addEventListener('click', () => show(4));

  $$('#ob-purposes .purpose-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      data.purpose = cell.dataset.p;
      $$('#ob-purposes .purpose-cell').forEach(c => c.classList.toggle('picked', c === cell));
      $('#ob-next-3').disabled = false;
    });
  });

  // dark-mode toggle inside the overlay
  const themeBtn = $('#ob-theme');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const root2 = document.documentElement;
      const next = root2.dataset.theme === 'dark' ? 'light' : 'dark';
      // write to the same key app.js uses, then call its applyTheme so the
      // sidebar toggle label updates too.
      try { localStorage.setItem('unsent_theme', next); } catch (e) { /* noop */ }
      if (typeof window.applyTheme === 'function') window.applyTheme(next);
      else {
        root2.dataset.theme = next;
        const sidebarBtn = $('#themeToggle');
        if (sidebarBtn) sidebarBtn.textContent = next === 'dark' ? '☀' : '☾';
      }
    });
  }

  $('#ob-finish').addEventListener('click', async () => {
    const finishBtn = $('#ob-finish');
    if (finishBtn.disabled) return;
    finishBtn.disabled = true;
    finishBtn.textContent = 'Saving…';
    try {
      if (typeof window.api !== 'function') throw new Error('API not ready — try again in a moment');
      const payload = {
        user_display_name: data.name,
        aria_mascot: data.mascot,
        onboarding_purpose: data.purpose,
        onboarding_mood: data.mood,
        onboarding_complete: true,
      };
      await window.api('/api/settings', { method: 'PATCH', body: payload });
      root.hidden = true;
      window.toast && window.toast('Welcome, ' + data.name + ' ✨', 'good');
      if (data.mood && window.state && Array.isArray(window.state.chat)) {
        const moodMeta = (window.state.moods || []).find(m => m.id === data.mood);
        if (moodMeta) {
          window.state.chat.push({ role: 'ai', text: `Hey ${data.name}. You picked ${(moodMeta.name || moodMeta.id).toLowerCase()}. I'm here.` });
          window.renderChat && window.renderChat();
        }
      }
      window.dispatchEvent(new CustomEvent('onboarding:complete', { detail: data }));
    } catch (e) {
      window.toast && window.toast('Could not save: ' + e.message, 'error');
      finishBtn.disabled = false;
      finishBtn.textContent = 'Begin';
    }
  });

  root.addEventListener('click', e => {
    const back = e.target.closest('[data-back]');
    if (back && step > 1) show(step - 1);
  });
}

export async function maybeStart() {
  let settings;
  try {
    if (typeof window.api !== 'function') {
      // api may not be on window yet — wait one tick
      await new Promise(r => setTimeout(r, 50));
    }
    settings = await window.api('/api/settings');
  } catch (e) {
    console.warn('onboarding: could not load settings', e);
    return;
  }
  if (settings && settings.onboarding_complete) return;
  const root = $('#onboarding');
  if (!root) return;
  wireNav();
  show(1);
  root.hidden = false;
}
