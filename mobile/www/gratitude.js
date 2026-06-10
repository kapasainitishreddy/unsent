// Gratitude Garden — every entry plants a seed. Each seed grows from sprout
// to flower over time. No free-tier limit; this is a free, accumulating
// feature.
//
// Stages (from /api/gratitude/garden):
//   0  seed    < 1 day     — a small brown seed in the dirt
//   1  sprout  1-3 days    — two tiny green leaves
//   2  leaf    4-7 days    — bigger leaf, more color
//   3  bloom   8-30 days   — flower bud opening
//   4  full    > 30 days   — full flower in bloom

const STAGE_LABELS = ['seed', 'sprout', 'leaf', 'bloom', 'full bloom'];
const STAGE_COLORS = ['#8a7560', '#5a9b5a', '#4d8a4d', '#e08850', '#d94a7a'];

const $ = (s, r = document) => r.querySelector(s);

let activeTag = 'moment';
let entries = [];

// --- SVG plant renderer -----------------------------------------------
function plantSvg(stage, accent = '#4d8a4d') {
  const s = Math.max(0, Math.min(4, stage | 0));
  // Each stage has a different SVG. Simple, hand-drawn, warm.
  switch (s) {
    case 0: // seed
      return `<svg viewBox="0 0 60 60" aria-hidden="true">
        <ellipse cx="30" cy="50" rx="14" ry="3" fill="#8a7560" fill-opacity="0.3"/>
        <ellipse cx="30" cy="48" rx="6" ry="3.5" fill="#8a7560" />
      </svg>`;
    case 1: // sprout
      return `<svg viewBox="0 0 60 60" aria-hidden="true">
        <ellipse cx="30" cy="52" rx="16" ry="3" fill="#8a7560" fill-opacity="0.3"/>
        <path d="M30 50 V36" stroke="${accent}" stroke-width="2" stroke-linecap="round" fill="none"/>
        <path d="M30 38 Q22 32 18 36 Q22 40 30 38" fill="${accent}" fill-opacity="0.7" />
        <path d="M30 38 Q38 32 42 36 Q38 40 30 38" fill="${accent}" fill-opacity="0.7" />
      </svg>`;
    case 2: // leaf
      return `<svg viewBox="0 0 60 60" aria-hidden="true">
        <ellipse cx="30" cy="54" rx="18" ry="3" fill="#8a7560" fill-opacity="0.3"/>
        <path d="M30 54 V26" stroke="${accent}" stroke-width="2" stroke-linecap="round" fill="none"/>
        <path d="M30 28 Q18 20 14 28 Q18 36 30 32 Z" fill="${accent}" fill-opacity="0.8" />
        <path d="M30 28 Q42 20 46 28 Q42 36 30 32 Z" fill="${accent}" fill-opacity="0.8" />
        <circle cx="30" cy="22" r="2.5" fill="#fed7aa" />
      </svg>`;
    case 3: // bloom
      return `<svg viewBox="0 0 60 60" aria-hidden="true">
        <ellipse cx="30" cy="54" rx="20" ry="3" fill="#8a7560" fill-opacity="0.3"/>
        <path d="M30 54 V22" stroke="${accent}" stroke-width="2" stroke-linecap="round" fill="none"/>
        <path d="M30 24 Q16 16 12 24 Q16 32 30 28 Z" fill="${accent}" fill-opacity="0.7" />
        <path d="M30 24 Q44 16 48 24 Q44 32 30 28 Z" fill="${accent}" fill-opacity="0.7" />
        <g transform="translate(30 18)">
          <circle r="6" fill="#fed7aa" />
          <circle r="3" fill="#c2410c" />
        </g>
      </svg>`;
    case 4: // full bloom
    default: {
      const petal = ['#d94a7a', '#fb923c', '#fed7aa', '#fb923c'];
      return `<svg viewBox="0 0 60 60" aria-hidden="true">
        <ellipse cx="30" cy="54" rx="22" ry="3" fill="#8a7560" fill-opacity="0.3"/>
        <path d="M30 54 V18" stroke="${accent}" stroke-width="2" stroke-linecap="round" fill="none"/>
        <path d="M30 22 Q14 14 10 22 Q14 30 30 26 Z" fill="${accent}" fill-opacity="0.7" />
        <path d="M30 22 Q46 14 50 22 Q46 30 30 26 Z" fill="${accent}" fill-opacity="0.7" />
        <g transform="translate(30 16)">
          <ellipse cx="-5" cy="0" rx="5" ry="6" fill="${petal[0]}" />
          <ellipse cx="5"  cy="0" rx="5" ry="6" fill="${petal[0]}" />
          <ellipse cx="0"  cy="-5" rx="6" ry="5" fill="${petal[1]}" />
          <ellipse cx="0"  cy="5"  rx="6" ry="5" fill="${petal[1]}" />
          <circle r="3.5" fill="#c2410c" />
        </g>
      </svg>`;
    }
  }
}

function agoLabel(ts) {
  const d = Date.now() - ts;
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function renderGarden() {
  const canvas = $('#garden-canvas');
  const count = $('#grat-count');
  if (!canvas) return;
  if (entries.length === 0) {
    canvas.innerHTML = `<div class="garden-plot"><div style="color:var(--ink-faint);font:italic 13px/1.4 'Fraunces',Georgia,serif;text-align:center;padding:60px 0">an empty plot, waiting for a seed</div></div>`;
    if (count) count.textContent = '';
    return;
  }
  // Sort: oldest first so the rightmost is newest, like a growing row
  const sorted = [...entries].sort((a, b) => a.created_at - b.created_at);
  canvas.innerHTML = `<div class="garden-plot">${sorted.map(e => {
    const color = STAGE_COLORS[e.stage] || STAGE_COLORS[0];
    return `<div class="plant" title="${escapeAttr(e.text)}">
      ${plantSvg(e.stage, color)}
      <div class="plant-stage-tag">${STAGE_LABELS[e.stage] || 'seed'}</div>
      <div class="plant-label">${escapeHtml(e.text)}</div>
    </div>`;
  }).join('')}</div>`;
  if (count) {
    count.textContent = `${entries.length} ${entries.length === 1 ? 'plant' : 'plants'} growing`;
  }
}

function renderList() {
  const list = $('#grat-list');
  if (!list) return;
  if (entries.length === 0) {
    list.innerHTML = '<p style="color:var(--ink-soft);font-size:14px;font-style:italic">Nothing planted yet. Add one above.</p>';
    return;
  }
  const sorted = [...entries].sort((a, b) => b.created_at - a.created_at);
  list.innerHTML = sorted.map(e => `
    <div class="grat-entry" data-id="${e.id}">
      <div class="grat-entry-text">
        ${escapeHtml(e.text)}
        <div class="grat-entry-meta">${e.tag} · ${agoLabel(e.created_at)} · ${STAGE_LABELS[e.stage] || 'seed'}</div>
      </div>
      <button class="delete-x" data-del="${e.id}" title="Remove">×</button>
    </div>
  `).join('');
}

async function load() {
  try {
    const res = await window.api('/api/gratitude/garden');
    entries = res.garden || [];
  } catch (e) {
    console.warn('gratitude load failed', e);
    entries = [];
  }
  renderGarden();
  renderList();
}

async function plant(text, tag) {
  await window.api('/api/gratitude', {
    method: 'POST',
    body: { text, tag },
  });
  await load();
}

async function remove(id) {
  await window.api(`/api/gratitude/${id}`, { method: 'DELETE' });
  await load();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

function wire() {
  // tag picker
  const tagsRow = $('#grat-tags');
  if (tagsRow) {
    tagsRow.addEventListener('click', e => {
      const btn = e.target.closest('.grat-tag');
      if (!btn) return;
      activeTag = btn.dataset.tag;
      $$('.grat-tag', tagsRow).forEach(b => b.classList.toggle('picked', b === btn));
    });
  }
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // plant
  const save = $('#grat-save');
  if (save) {
    save.addEventListener('click', async () => {
      const ta = $('#grat-text');
      const text = (ta?.value || '').trim();
      if (!text) { window.toast && window.toast('Write what you\'re grateful for.', 'info'); return; }
      save.disabled = true;
      const original = save.textContent;
      save.textContent = 'Planting…';
      try {
        await plant(text, activeTag);
        if (ta) ta.value = '';
        window.toast && window.toast('Planted. Watch it grow. 🌱', 'good');
      } catch (e) {
        window.toast && window.toast('Could not plant: ' + e.message, 'error');
      } finally {
        save.disabled = false;
        save.textContent = original;
      }
    });
  }

  // delete
  const list = $('#grat-list');
  if (list) {
    list.addEventListener('click', async e => {
      const btn = e.target.closest('[data-del]');
      if (!btn) return;
      const id = btn.dataset.del;
      if (!confirm('Remove this from your garden?')) return;
      try {
        await remove(id);
        window.toast && window.toast('Removed.', 'good');
      } catch (e) {
        window.toast && window.toast('Could not remove: ' + e.message, 'error');
      }
    });
  }
}

export async function init() {
  wire();
  await load();
}
