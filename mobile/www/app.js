// unsent demo client
// vanilla JS, no build step. speaks to /api/* on the same origin.

import { VoiceInput, speak, stopSpeaking } from './voice.js';
import { initClerk, getClerkToken } from './clerk.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// ---------------- theme ----------------
const THEME_KEY = 'unsent_theme';
function initTheme() {
  let saved = localStorage.getItem(THEME_KEY);
  if (!saved) saved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  applyTheme(saved);
  const btn = $('#themeToggle');
  if (btn) btn.addEventListener('click', () => {
    const next = (document.documentElement.dataset.theme === 'dark') ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
}

// applyTheme is defined below (line 80) with a more complete implementation
// that also updates the onboarding overlay toggle. Don't redefine here.

const state = {
  me: null,
  settings: null,
  vents: [],
  unsent: [],
  unsentFilter: 'all',
  journal: [],
  moodCheckins: [],
  moodPicked: null,
  affirmations: [],
  affirmMood: '',
  coping: [],
  intentions: [],
  avatar: null,
  chat: [],
  moods: [],
  skin: [],
  hair: [],
  glasses: [],
  expressions: [],
  crisisShown: new Set(),
};

// ---------------- API ----------------
async function api(path, opts = {}) {
  const token = getClerkToken();
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(path, {
    headers,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const err = new Error(body?.error || body?.message || `${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  setTimeout(() => el.className = 'toast ' + kind, 2400);
}

function applyTheme(theme) {
  const html = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    html.dataset.theme = prefersDark ? 'dark' : 'light';
  } else {
    html.dataset.theme = theme || 'light';
  }
  // keep both toggles in sync (sidebar + onboarding overlay)
  const sb = document.getElementById('themeToggle');
  if (sb) sb.textContent = html.dataset.theme === 'dark' ? '☀' : '☾';
  const ob = document.getElementById('ob-theme');
  if (ob) ob.textContent = html.dataset.theme === 'dark' ? '☀' : '☾';
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// ---------------- nav ----------------
$$('.nav-item').forEach(el => {
  el.addEventListener('click', () => {
    const target = el.dataset.surface;
    $$('.nav-item').forEach(n => n.classList.toggle('active', n === el));
    $$('.surface').forEach(s => s.classList.toggle('active', s.dataset.surface === target));
    if (target === 'avatar') renderAvatar();
    if (target === 'account') import('./aria.js').then(m => m.init()).catch(err => console.warn(err));
  });
});

// ---------------- me + settings + counts ----------------
async function loadMe() {
  state.me = await api('/api/me');
  const [settings, meta, avatar] = await Promise.all([
    api('/api/settings'),
    api('/api/meta'),
    api('/api/avatar'),
  ]);
  state.settings = settings;
  const card = $('#meCard');
  card.innerHTML = `
    <div class="me-name">${state.me.user_id}</div>
    <div class="me-meta">
      <span class="dot" style="background:${state.me.auth_mode === 'clerk' ? 'var(--accent)' : 'var(--good)'}"></span>
      <span>${state.me.auth_mode} · ${state.me.premium ? 'premium' : 'free'}</span>
    </div>
  `;
  state.moods = meta.moods || [];
  state.skin = meta.skin || [];
  state.hair = meta.hair || [];
  state.glasses = meta.glasses || [];
  state.expressions = meta.expressions || [];
  state.avatar = avatar || { skin_tone: null, hair_color: null, glasses: 'none', expression: 'calm' };

  // populate vent mood select
  const sel = $('#vent-mood');
  sel.innerHTML = '<option value="">— pick one —</option>' +
    state.moods.map(m => `<option value="${m.id}">${m.emoji} ${m.name}</option>`).join('');

  // populate mood picker grid
  const grid = $('#mood-picker');
  grid.innerHTML = state.moods.map(m => `
    <div class="mood-cell" data-id="${m.id}">
      <div class="emoji">${m.emoji}</div>
      <div>
        <div class="name">${m.name}</div>
      </div>
    </div>
  `).join('');
  $$('.mood-cell', grid).forEach(cell => {
    cell.addEventListener('click', () => {
      $$('.mood-cell', grid).forEach(c => c.classList.toggle('selected', c === cell));
      state.moodPicked = cell.dataset.id;
      $('#mood-save').disabled = false;
    });
  });
}

async function loadCounts() {
  const [v, u, j, m] = await Promise.all([
    api('/api/vents?limit=1'),
    api('/api/unsent?limit=1'),
    api('/api/journal?limit=1'),
    api('/api/mood?limit=1'),
  ]);
  $('#badge-vents').textContent = v.total ?? 0;
  $('#badge-unsent').textContent = u.total ?? 0;
  $('#badge-journal').textContent = j.total ?? 0;
  $('#badge-mood').textContent = m.total ?? 0;

  // quota meter
  if (v.used_today !== undefined) {
    const q = $('#vent-quota');
    q.style.display = 'flex';
    const limit = v.limit_per_day || 3;
    const used = v.used_today;
    $('#vent-quota-text').textContent = `${used} / ${limit} vents used today`;
    $('#vent-quota-fill').style.width = `${Math.min(100, (used / limit) * 100)}%`;
  }
}

// ---------------- vents ----------------
async function loadVents() {
  const data = await api('/api/vents?limit=20');
  state.vents = data.vents || [];
  const list = $('#vent-list');
  if (state.vents.length === 0) {
    list.innerHTML = emptyState('feather', 'Nothing vented yet', 'Get the first one out of your head.');
    return;
  }
  list.innerHTML = state.vents.map(v => `
    <div class="entry">
      <div class="card-head">
        <h3>${escapeHtml(v.title && v.title.trim() ? v.title : 'untitled vent')}</h3>
        <span class="meta">${when(v.created_at)}</span>
      </div>
      <div class="entry-body">${escapeHtml(v.body)}</div>
      <div class="entry-foot">
        ${v.mood ? `<span class="chip">${moodName(v.mood)}</span>` : ''}
        ${v.intensity != null ? `<span class="chip ${v.intensity >= 7 ? 'warn' : ''}">intensity ${v.intensity}/10</span>` : ''}
        ${v.released ? '<span class="chip good">released</span>' : ''}
        <div class="entry-actions" style="margin-left:auto">
          ${!v.released ? `<button class="btn btn-sm btn-outline" data-act="release" data-id="${v.id}">Mark released</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-act="del-vent" data-id="${v.id}">Delete</button>
        </div>
      </div>
    </div>
  `).join('');
}

$('#vent-save').addEventListener('click', async () => {
  const title = $('#vent-title').value.trim();
  const body = $('#vent-body').value.trim();
  const mood = $('#vent-mood').value;
  const intensity = parseInt($('#vent-intensity').value, 10);
  if (!body) { toast('Write something first', 'error'); return; }
  try {
    await api('/api/vents', { method: 'POST', body: { title, body, mood: mood || null, mood_at_vent: mood || null, intensity } });
    $('#vent-title').value = '';
    $('#vent-body').value = '';
    await loadVents();
    await loadCounts();
    toast('Released', 'good');
  } catch (e) {
    if (e.status === 402) {
      toast('Free tier limit reached. Upgrade for unlimited vents.', 'error');
    } else {
      toast(e.message, 'error');
    }
  }
});

$('#vent-intensity').addEventListener('input', e => {
  $('#vent-intensity-val').textContent = e.target.value;
});

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'release') {
    await api(`/api/vents/${id}`, { method: 'PATCH', body: { released: 1 } });
    await loadVents();
  }
  if (btn.dataset.act === 'del-vent') {
    await api(`/api/vents/${id}`, { method: 'DELETE' });
    await loadVents();
    await loadCounts();
  }
});

// ---------------- unsent ----------------
async function loadUnsent() {
  const data = await api(`/api/unsent?limit=50&outcome=${state.unsentFilter === 'all' ? '' : state.unsentFilter}`);
  state.unsent = data.unsent || data.messages || [];
  const list = $('#unsent-list');
  if (state.unsent.length === 0) {
    list.innerHTML = emptyState('envelope', 'No unsent messages', 'Write one to someone. You don\'t have to send it.');
    return;
  }
  list.innerHTML = state.unsent.map(u => `
    <div class="entry">
      <div class="card-head">
        <h3>To: ${escapeHtml(u.recipient_name && u.recipient_name.trim() ? u.recipient_name : 'someone')}</h3>
        <span class="meta">${when(u.created_at)}</span>
      </div>
      <div class="entry-foot" style="margin-bottom:10px">
        <span class="chip accent">${u.shape}</span>
        <span class="chip ${u.outcome}">${u.outcome}</span>
      </div>
      ${u.outcome === 'deleted' ? '<div class="entry-body muted">[released without sending]</div>' : `<div class="entry-body">${escapeHtml(u.body)}</div>`}
      <div class="entry-actions">
        ${u.outcome === 'private' ? `<button class="btn btn-sm btn-outline" data-act="mark-sent" data-id="${u.id}">Mark as sent</button>` : ''}
        ${u.outcome === 'private' ? `<button class="btn btn-sm btn-ghost" data-act="del-unsent" data-id="${u.id}">Release</button>` : ''}
        ${u.outcome === 'deleted' ? `<button class="btn btn-sm btn-ghost" data-act="del-unsent" data-id="${u.id}">Delete</button>` : ''}
      </div>
    </div>
  `).join('');
}

$('#unsent-save').addEventListener('click', async () => {
  const to = $('#unsent-to').value.trim();
  const body = $('#unsent-body').value.trim();
  const shape = $('#unsent-shape').value;
  if (!body || !to) { toast('Add a name and a message', 'error'); return; }
  await api('/api/unsent', { method: 'POST', body: { recipient_name: to, shape, body, outcome: 'private' } });
  $('#unsent-to').value = '';
  $('#unsent-body').value = '';
  await loadUnsent();
  await loadCounts();
  toast('Saved as unsent', 'good');
});

$('#unsent-pills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  state.unsentFilter = pill.dataset.filter;
  $$('.pill', $('#unsent-pills')).forEach(p => p.classList.toggle('active', p === pill));
  loadUnsent();
});

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.dataset.id;
  if (btn.dataset.act === 'mark-sent') {
    await api(`/api/unsent/${id}`, { method: 'PATCH', body: { outcome: 'sent' } });
    await loadUnsent(); await loadCounts();
  }
  if (btn.dataset.act === 'del-unsent') {
    await api(`/api/unsent/${id}`, { method: 'PATCH', body: { outcome: 'deleted' } });
    await loadUnsent(); await loadCounts();
  }
});

// ---------------- journal ----------------
async function loadJournal() {
  const data = await api('/api/journal?limit=20');
  state.journal = data.entries || [];
  const list = $('#journal-list');
  if (state.journal.length === 0) {
    list.innerHTML = emptyState('moon', 'No entries yet', 'Start with one sentence. That\'s a journal entry.');
    return;
  }
  list.innerHTML = state.journal.map(j => `
    <div class="entry">
      <div class="card-head">
        <h3>${escapeHtml(j.title || 'untitled')}</h3>
        <span class="meta">${when(j.created_at)}</span>
      </div>
      ${j.prompt ? `<div style="color:var(--ink-soft);font-style:italic;font-size:13px;margin-bottom:10px">${escapeHtml(j.prompt)}</div>` : ''}
      <div class="entry-body">${escapeHtml(j.body)}</div>
      ${j.mood_at_write ? `<div class="entry-foot"><span class="chip">${moodName(j.mood_at_write)}</span></div>` : ''}
      <div class="entry-actions">
        <button class="btn btn-sm btn-ghost" data-act="del-journal" data-id="${j.id}">Delete</button>
      </div>
    </div>
  `).join('');
}

$('#journal-save').addEventListener('click', async () => {
  const title = $('#journal-title').value.trim();
  const body = $('#journal-body').value.trim();
  const prompt = $('#journal-prompt').value;
  if (!body) { toast('Write a sentence at least', 'error'); return; }
  await api('/api/journal', { method: 'POST', body: { title, body, prompt: prompt || null } });
  $('#journal-title').value = '';
  $('#journal-body').value = '';
  $('#journal-prompt').value = '';
  await loadJournal();
  await loadCounts();
  toast('Saved', 'good');
});

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'del-journal') {
    await api(`/api/journal/${btn.dataset.id}`, { method: 'DELETE' });
    await loadJournal(); await loadCounts();
  }
});

// ---------------- mood ----------------
$('#mood-intensity').addEventListener('input', e => {
  $('#mood-intensity-val').textContent = e.target.value;
});

$('#mood-save').addEventListener('click', async () => {
  if (!state.moodPicked) return;
  const intensity = parseInt($('#mood-intensity').value, 10);
  const triggers = $('#mood-triggers').value.split(',').map(s => s.trim()).filter(Boolean);
  const notes = $('#mood-notes').value.trim();
  await api('/api/mood', { method: 'POST', body: { mood: state.moodPicked, intensity, triggers, notes: notes || null } });
  $('#mood-triggers').value = '';
  $('#mood-notes').value = '';
  state.moodPicked = null;
  $$('.mood-cell').forEach(c => c.classList.remove('selected'));
  $('#mood-save').disabled = true;
  await loadMood();
  await loadCounts();
  toast('Logged', 'good');
});

async function loadMood() {
  const data = await api('/api/mood?limit=7');
  state.moodCheckins = data.checkins || [];
  const hist = $('#mood-history');
  if (state.moodCheckins.length === 0) {
    hist.innerHTML = '<div style="grid-column:1/-1;color:var(--ink-soft);font-size:13px;text-align:center;padding:20px">No check-ins yet</div>';
    return;
  }
  hist.innerHTML = state.moodCheckins.map(c => {
    const mood = state.moods.find(m => m.id === c.mood);
    return `<div class="mood-bar"><span class="e">${mood?.emoji || '·'}</span>${when(c.created_at).replace(' ago', '')}</div>`;
  }).join('');
}

// ---------------- affirmations ----------------
async function loadAffirmations() {
  const q = state.affirmMood ? `?mood=${state.affirmMood}` : '';
  const data = await api('/api/affirmations' + q);
  state.affirmations = data.affirmations || [];
  const list = $('#affirm-list');
  if (state.affirmations.length === 0) {
    list.innerHTML = emptyState('leaf', 'No affirmations for this filter', 'Add one, or change the filter.');
    return;
  }
  list.innerHTML = state.affirmations.map(a => `
    <div class="aff-card ${a.source === 'user' ? 'user' : ''}">
      <div class="text">${escapeHtml(a.text)}</div>
      <div class="tags">${(a.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join('')}${a.source === 'user' ? '<span class="tag">yours</span>' : '<span class="tag">preset</span>'}</div>
      <div class="entry-actions">
        <button class="btn btn-sm btn-ghost" data-act="del-affirm" data-id="${a.id}">Remove</button>
      </div>
    </div>
  `).join('');
}

$('#affirm-pills').addEventListener('click', e => {
  const pill = e.target.closest('.pill');
  if (!pill) return;
  state.affirmMood = pill.dataset.mood;
  $$('.pill', $('#affirm-pills')).forEach(p => p.classList.toggle('active', p === pill));
  loadAffirmations();
});

$('#affirm-save').addEventListener('click', async () => {
  const text = $('#affirm-new').value.trim();
  const tags = $('#affirm-tags').value.split(',').map(s => s.trim()).filter(Boolean);
  if (!text) { toast('Type it first', 'error'); return; }
  await api('/api/affirmations', { method: 'POST', body: { text, tags, source: 'user' } });
  $('#affirm-new').value = '';
  $('#affirm-tags').value = '';
  await loadAffirmations();
  toast('Saved', 'good');
});

document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'del-affirm') {
    await api(`/api/affirmations/${btn.dataset.id}`, { method: 'DELETE' });
    await loadAffirmations();
  }
});

// ---------------- companion ----------------
function renderChat() {
  const chat = $('#chat');
  chat.innerHTML = state.chat.map((m, i) => `
    <div class="bubble ${m.role} ${m.crisis ? 'crisis' : ''}">
      ${m.crisis ? '<div style="font-weight:600;margin-bottom:6px">⚠️ I\'m hearing something that worries me.</div>' : ''}
      <div>${escapeHtml(m.text).replace(/\n/g, '<br/>')}</div>
      ${m.role === 'ai' ? `<button class="tts-btn" data-tts="${i}" title="Read aloud" aria-label="Read aloud"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg></button>` : ''}
      ${m.resources ? `<div style="margin-top:8px;font-size:12px;opacity:0.8">${m.resources.map(r => `<a href="${r.url || '#'}" style="color:inherit;text-decoration:underline" target="_blank">${escapeHtml(r.name)}</a>`).join(' · ')}</div>` : ''}
    </div>
  `).join('');
  chat.scrollTop = chat.scrollHeight;
  // wire tts buttons
  $$('.tts-btn', chat).forEach(btn => {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.tts);
      const msg = state.chat[i];
      if (!msg) return;
      if (btn.classList.contains('speaking')) {
        stopSpeaking();
        btn.classList.remove('speaking');
        return;
      }
      $$('.tts-btn', chat).forEach(b => b.classList.remove('speaking'));
      btn.classList.add('speaking');
      speak(msg.text, { rate: 0.95, pitch: 1.05 });
      // estimate end (rough — web speech doesn't give us a 'done' event reliably)
      setTimeout(() => btn.classList.remove('speaking'), (msg.text.length * 60) + 1000);
    });
  });
}

async function sendChat() {
  const input = $('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  state.chat.push({ role: 'user', text });
  input.value = '';
  renderChat();
  try {
    const res = await api('/api/ai/companion', { method: 'POST', body: { message: text } });
    state.chat.push({ role: 'ai', text: res.reply, crisis: res.crisis, resources: res.resources });
    renderChat();
  } catch (e) {
    state.chat.push({ role: 'ai', text: 'Something went wrong: ' + e.message });
    renderChat();
  }
}

$('#chat-send').addEventListener('click', sendChat);
$('#chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
});

// ---------------- coping ----------------
async function loadCoping() {
  const data = await api('/api/coping?limit=20');
  state.coping = data.sessions || [];
  const list = $('#coping-list');
  if (state.coping.length === 0) {
    list.innerHTML = emptyState('wave', 'No coping sessions logged', 'When you reach for a tool, log it.');
    return;
  }
  list.innerHTML = state.coping.map(c => `
    <div class="entry">
      <div class="card-head">
        <h3>${formatTool(c.tool)}</h3>
        <span class="meta">${when(c.created_at)}</span>
      </div>
      <div class="entry-foot">
        <span class="chip">${c.duration_sec}s</span>
        ${c.helpful === true ? '<span class="chip good">helpful</span>' : ''}
        ${c.helpful === false ? '<span class="chip warn">not helpful</span>' : ''}
        ${c.helpful == null ? '<span class="chip">unrated</span>' : ''}
      </div>
    </div>
  `).join('');
}

$('#coping-save').addEventListener('click', async () => {
  const tool = $('#coping-tool').value;
  const duration_sec = parseInt($('#coping-duration').value, 10);
  const helpfulRaw = $('#coping-helpful').value;
  const helpful = helpfulRaw === 'null' ? null : helpfulRaw === 'true';
  await api('/api/coping', { method: 'POST', body: { tool, duration_sec, helpful } });
  await loadCoping();
  toast('Logged', 'good');
});

// ---------------- intentions ----------------
async function loadIntentions() {
  const data = await api('/api/intentions?limit=20');
  state.intentions = data.intentions || [];
  const list = $('#intention-list');
  if (state.intentions.length === 0) {
    list.innerHTML = emptyState('sprout', 'No intentions set', 'Pick one tiny thing for today.');
    return;
  }
  list.innerHTML = state.intentions.map(i => `
    <div class="entry">
      <div class="entry-foot" style="margin-bottom:0">
        <span class="chip accent">${i.kind}</span>
        <span class="chip">${i.cadence}</span>
        <span class="chip ${i.status}">${i.status}</span>
        <span class="when">${when(i.created_at)}</span>
      </div>
      <div class="entry-body" style="margin-top:10px">${escapeHtml(i.body)}</div>
    </div>
  `).join('');
}

$('#intention-save').addEventListener('click', async () => {
  const kind = $('#intention-kind').value;
  const body = $('#intention-body').value.trim();
  const cadence = $('#intention-cadence').value;
  if (!body) { toast('Write one', 'error'); return; }
  await api('/api/intentions', { method: 'POST', body: { kind, body, cadence } });
  $('#intention-body').value = '';
  await loadIntentions();
  toast('Set', 'good');
});

// ---------------- avatar ----------------
function renderAvatar() {
  const a = state.avatar || {};
  const frame = $('#avatar-frame');
  // Render a symbolic SVG avatar using the saved fields.
  const skin = a.skin_tone || '#eac4a1';
  const hair = a.hair_color || '#3a2a1a';
  const glasses = a.glasses || 'none';
  const expr = a.expression || 'calm';
  const exprMap = {
    calm: '·_·',
    listening: '·◡·',
    nodding: '·‿·',
    soft_smile: '·‿·',
    concerned: '·︵·',
    breathing: '·~·',
    heart: '·♥·',
    release: '·◌·',
  };
  const eyes = exprMap[expr] || '·_·';
  frame.innerHTML = `
    <svg viewBox="0 0 200 200" width="100%" height="100%" style="border-radius:24px">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#fbe9d2"/>
          <stop offset="100%" stop-color="#e8c79e"/>
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill="url(#bg)"/>
      <!-- hair back -->
      <ellipse cx="100" cy="80" rx="58" ry="48" fill="${hair}"/>
      <!-- face -->
      <ellipse cx="100" cy="105" rx="48" ry="55" fill="${skin}"/>
      <!-- hair front fringe -->
      <path d="M52,82 Q60,55 100,50 Q140,55 148,82 Q140,68 100,68 Q60,68 52,82 Z" fill="${hair}"/>
      <!-- eyes -->
      <text x="78" y="115" font-family="Fraunces, serif" font-size="20" fill="#2a2620">${eyes.split('')[0] || '·'}</text>
      <text x="110" y="115" font-family="Fraunces, serif" font-size="20" fill="#2a2620">${eyes.split('').slice(-1)[0] || '·'}</text>
      <!-- mouth -->
      <path d="M86,138 Q100,${expr === 'soft_smile' || expr === 'heart' ? '148' : '142'} 114,138" stroke="#2a2620" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      ${glasses === 'round' ? `
        <circle cx="82" cy="112" r="13" fill="none" stroke="#2a2620" stroke-width="2"/>
        <circle cx="118" cy="112" r="13" fill="none" stroke="#2a2620" stroke-width="2"/>
        <line x1="95" y1="112" x2="105" y2="112" stroke="#2a2620" stroke-width="2"/>
      ` : ''}
      ${glasses === 'square' ? `
        <rect x="68" y="100" width="28" height="22" rx="2" fill="none" stroke="#2a2620" stroke-width="2"/>
        <rect x="104" y="100" width="28" height="22" rx="2" fill="none" stroke="#2a2620" stroke-width="2"/>
        <line x1="96" y1="111" x2="104" y2="111" stroke="#2a2620" stroke-width="2"/>
      ` : ''}
      ${glasses === 'cateye' ? `
        <path d="M68,110 Q82,98 96,110 Q82,118 68,110" fill="none" stroke="#2a2620" stroke-width="2"/>
        <path d="M104,110 Q118,98 132,110 Q118,118 104,110" fill="none" stroke="#2a2620" stroke-width="2"/>
      ` : ''}
    </svg>
  `;
  renderSwatches('#opt-skin', state.skin, a.skin_tone, 'skin_tone', 'color');
  renderSwatches('#opt-hair', state.hair, a.hair_color, 'hair_color', 'color');
  renderSwatches('#opt-glasses', state.glasses, a.glasses, 'glasses', 'text');
  renderSwatches('#opt-expression', state.expressions, a.expression, 'expression', 'text');
}

function renderSwatches(sel, options, current, field, kind) {
  const root = $(sel);
  if (!options || options.length === 0) {
    root.innerHTML = '<span style="color:var(--ink-faint);font-size:12px">none</span>';
    return;
  }
  root.innerHTML = options.map(o => {
    const val = typeof o === 'string' ? o : o.value;
    const name = typeof o === 'string' ? o : (o.name || o.value);
    if (kind === 'color') {
      return `<div class="swatch ${val === current ? 'active' : ''}" data-val="${val}" data-field="${field}" style="background:${val}" title="${name}"></div>`;
    } else {
      return `<div class="swatch text ${val === current ? 'active' : ''}" data-val="${val}" data-field="${field}" style="font-size:12px;display:flex;align-items:center;justify-content:center;font-weight:600">${name}</div>`;
    }
  }).join('');
}

document.addEventListener('click', async e => {
  const sw = e.target.closest('.swatch');
  if (!sw) return;
  const field = sw.dataset.field;
  const val = sw.dataset.val;
  state.avatar[field] = val;
  renderAvatar();
  try {
    await api('/api/avatar', { method: 'PATCH', body: { [field]: val } });
  } catch (err) {
    toast('Could not save: ' + err.message, 'error');
  }
});

// ---------------- data ----------------
$('#export-btn').addEventListener('click', async () => {
  const data = await api('/api/export');
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `unsent-export-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Downloaded', 'good');
});

$('#wipe-btn').addEventListener('click', async () => {
  if (!confirm('This will permanently delete all your data. Are you sure?')) return;
  try {
    await api('/api/wipe', { method: 'POST', body: { confirm: 'DELETE' } });
    toast('Wiped', 'good');
    await Promise.all([loadVents(), loadUnsent(), loadJournal(), loadMood(), loadAffirmations(), loadCoping(), loadIntentions(), loadCounts()]);
  } catch (e) {
    toast(e.message, 'error');
  }
});

// ---------------- utils ----------------
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function moodName(id) {
  const m = state.moods.find(x => x.id === id);
  return m ? `${m.emoji} ${m.name}` : (id || '—');
}
function formatTool(t) {
  return String(t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function emptyState(arg, title, sub) {
  // arg can be a mascot key ('feather', 'moon', ...) or a plain emoji.
  const isMascot = ['crane','moon','feather','leaf','wave','envelope','sprout','heart'].includes(arg);
  const visual = isMascot ? mascot(arg) : `<div class="e">${arg}</div>`;
  return `<div class="empty">${visual}<h3>${title}</h3><p>${sub}</p></div>`;
}

// ---------------- mascots ----------------
// small hand-drawn SVGs. keep them simple — one color, ~2px stroke.
function mascot(name, bare = false) {
  const a = (svg) => bare ? svg : `<div class="mascot">${svg}</div>`;
  switch (name) {
    case 'crane': // companion tab — paper crane, soft amber
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 60 Q38 30 62 18" />
          <path d="M12 60 L34 50 L46 60 L28 66 Z" fill="currentColor" fill-opacity="0.22" />
          <path d="M34 50 Q42 34 60 20" />
          <circle cx="61.5" cy="18.5" r="2" fill="currentColor" />
          <path d="M63 17 L70 14" />
          <path d="M40 44 L46 38" opacity="0.6" />
        </g>
      </svg>`);
    case 'moon': // journal tab — crescent moon with a tiny star
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g>
          <path d="M50 18 A26 26 0 1 0 62 50 A20 20 0 0 1 50 18 Z" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
          <path d="M22 22 L24 26 L28 27 L24 28 L22 32 L20 28 L16 27 L20 26 Z" fill="var(--accent)"/>
          <circle cx="32" cy="40" r="0.8" fill="var(--ink-faint)"/>
        </g>
      </svg>`);
    case 'feather': // vent tab — a single feather
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M58 16 Q35 25 25 50 Q22 60 26 66 Q40 60 52 42 Q60 30 60 18 Z" fill="var(--accent-soft)"/>
          <path d="M58 16 L26 66" />
          <path d="M40 32 L36 38" /><path d="M46 36 L42 42" /><path d="M52 40 L48 46" />
        </g>
      </svg>`);
    case 'leaf': // mood / affirmation tab — a small leaf with a smile
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">
          <path d="M18 56 Q22 28 56 18 Q52 52 22 60 Z" />
          <path d="M22 60 Q34 48 50 30" fill="none"/>
        </g>
      </svg>`);
    case 'wave': // coping tab — soft water ripple
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 30 Q26 22 38 30 T62 30" />
          <path d="M14 42 Q26 34 38 42 T62 42" />
          <path d="M14 54 Q26 46 38 54 T62 54" />
        </g>
      </svg>`);
    case 'envelope': // unsent tab — closed envelope, will never be sent
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round">
          <rect x="14" y="24" width="52" height="36" rx="3" />
          <path d="M14 24 L40 46 L66 24" fill="none"/>
          <circle cx="64" cy="60" r="6" fill="var(--accent)" stroke="none"/>
          <path d="M60 60 L63 63 L68 57" fill="none" stroke="var(--bg)" stroke-width="2"/>
        </g>
      </svg>`);
    case 'sprout': // intentions tab
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M40 62 L40 38" />
          <path d="M40 50 Q28 46 26 32 Q38 34 40 48" fill="var(--accent-soft)"/>
          <path d="M40 42 Q52 38 56 26 Q44 28 40 40" fill="var(--accent-soft)"/>
        </g>
      </svg>`);
    case 'heart': // home / generic
      return a(`<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M40 60 C20 48 18 32 28 26 C36 22 40 28 40 32 C40 28 44 22 52 26 C62 32 60 48 40 60 Z"
              fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>
      </svg>`);
    default: return a(emoji || '·');
  }
}

// ---------------- voice input ----------------
function attachMic(textarea, { append = false } = {}) {
  if (!textarea) return null;
  // Skip if browser doesn't support and we're not native
  const probe = new VoiceInput({ onResult: () => {} });
  if (!probe.isSupported()) return null;

  // Wrap the textarea so we can put the mic button underneath it
  const wrapper = document.createElement('div');
  wrapper.className = 'voice-wrap';
  textarea.parentNode.insertBefore(wrapper, textarea);
  wrapper.appendChild(textarea);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mic-btn';
  btn.setAttribute('aria-label', 'Voice input');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="9" y="3" width="6" height="12" rx="3"/>
      <path d="M5 11a7 7 0 0 0 14 0"/>
      <line x1="12" y1="18" x2="12" y2="22"/>
    </svg>
    <span class="mic-label">Tap to talk</span>
  `;
  wrapper.appendChild(btn);

  const liveRegion = document.createElement('div');
  liveRegion.className = 'mic-live';
  liveRegion.setAttribute('aria-live', 'polite');
  wrapper.appendChild(liveRegion);

  let lastInsertionEnd = null;
  const v = new VoiceInput({
    onPartial: (text) => {
      liveRegion.textContent = text;
    },
    onResult: (text) => {
      liveRegion.textContent = '';
      const t = (text || '').trim();
      if (!t) return;
      // Insert at cursor if the field still has focus and we know where we were,
      // otherwise append.
      const start = textarea.selectionStart ?? textarea.value.length;
      const end = textarea.selectionEnd ?? textarea.value.length;
      const before = textarea.value.slice(0, start);
      const after = textarea.value.slice(end);
      const sep = (before && !before.endsWith(' ') && !before.endsWith('\n')) ? ' ' : '';
      textarea.value = before + sep + t + ' ' + after;
      const newPos = (before + sep + t + ' ').length;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      lastInsertionEnd = newPos;
    },
    onError: (e) => {
      liveRegion.textContent = '';
      btn.classList.remove('recording');
      toast(e.message || 'Voice input error', 'error');
    },
  });

  btn.addEventListener('click', async () => {
    if (v.active) {
      v.stop();
      btn.classList.remove('recording');
      liveRegion.textContent = '';
    } else {
      try {
        await v.start();
        btn.classList.add('recording');
        liveRegion.textContent = 'Listening…';
        // haptic on native
        const cap = () => (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
        const plugins = cap();
        if (plugins && plugins.Haptics) {
          try { await plugins.Haptics.impact({ style: 'light' }); } catch {}
        }
      } catch (e) {
        toast('Could not start voice input: ' + e.message, 'error');
      }
    }
  });

  // Watch v.active via a microtask poll so the button reverts when recognition
  // ends on its own (e.g. silence timeout). Lightweight — runs only while the
  // wrap is in the DOM.
  const poll = setInterval(() => {
    if (!v.active && btn.classList.contains('recording')) {
      btn.classList.remove('recording');
      liveRegion.textContent = '';
    }
    if (!document.body.contains(wrapper)) {
      clearInterval(poll);
    }
  }, 400);

  return { voice: v, button: btn, live: liveRegion };
}

// ---------------- boot ----------------
(async function init() {
  // theme first so the first paint is correct
  initTheme();

  // wire up Clerk (no-op if #clerkMount is absent)
  initClerk();

  // inject the paper crane next to "Aria" in the companion header
  const crane = $('#mascotCrane');
  if (crane) crane.innerHTML = mascot('crane', false);

  try {
    await loadMe();
    await Promise.all([loadVents(), loadUnsent(), loadJournal(), loadMood(), loadAffirmations(), loadCoping(), loadIntentions(), loadCounts()]);
    // start chat with a friendly greeting
    state.chat.push({ role: 'ai', text: 'Hey. I\'m here. What\'s on your mind?' });
    renderChat();
    // wire up voice input
    attachMic($('#vent-body'));
    attachMic($('#chat-input'));
  } catch (e) {
    toast('Could not load: ' + e.message, 'error');
    console.error(e);
  }

  // run first-run onboarding if needed (loads its own module).
  // attach window.* FIRST so onboarding can find api/state/mascot.
  window.api          = api;
  window.$            = $;
  window.state        = state;
  window.toast        = toast;
  window.mascot       = mascot;
  window.renderChat   = renderChat;
  window.loadMe       = loadMe;
  window.applyTheme   = applyTheme;

  // wire up the Account tab Upgrade button (RevenueCat in native, toast in browser)
  const upgradeBtn = $('#upgradeBtn');
  const premiumNote = $('#premiumNote');
  if (upgradeBtn) {
    if (state.me?.premium) {
      upgradeBtn.textContent = 'Premium active';
      upgradeBtn.disabled = true;
      upgradeBtn.classList.remove('btn-accent');
      upgradeBtn.classList.add('btn-outline');
    } else {
      upgradeBtn.addEventListener('click', async () => {
        upgradeBtn.disabled = true;
        upgradeBtn.textContent = 'Opening…';
        try {
          const mod = await import('./revenuecat.js').catch(() => null);
          if (mod && typeof mod.presentPaywall === 'function') {
            await mod.presentPaywall();
            await loadMe();
            if (state.me?.premium) {
              upgradeBtn.textContent = 'Premium active';
              upgradeBtn.classList.remove('btn-accent');
              upgradeBtn.classList.add('btn-outline');
              toast('Premium unlocked. Welcome.', 'ok');
              return;
            }
            upgradeBtn.disabled = false;
            upgradeBtn.textContent = 'Upgrade with Clerk';
          } else {
            // Native plugin not available — fall back to a friendly message.
            if (premiumNote) premiumNote.style.display = 'block';
            upgradeBtn.disabled = false;
            upgradeBtn.textContent = 'Upgrade with Clerk';
            toast('IAP only works in the native iOS/Android build.', 'info');
          }
        } catch (e) {
          console.error(e);
          upgradeBtn.disabled = false;
          upgradeBtn.textContent = 'Upgrade with Clerk';
          toast('Could not start purchase: ' + e.message, 'error');
        }
      });
    }
  }

  import('./onboarding.js').then(m => m.maybeStart()).catch(err => {
    console.warn('onboarding module failed to load:', err);
  });
})();
