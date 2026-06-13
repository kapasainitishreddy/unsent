// Healing — client UI for the heartbreak toolkit (/api/heartbreak/*).
// Renders into #healing-root. Uses the globals app.js exposes: window.api,
// window.toast. All event handling is delegated off the root, wired once.

const KINDS = {
  reason:   { label: 'Reasons it ended', tab: 'Reasons',  hint: 'Read these when you start to miss them.', ph: 'They never made time for me…' },
  trigger:  { label: 'Trigger map',      tab: 'Triggers', hint: 'Songs, places, dates — and a plan for each.', ph: 'Our song on the radio', plan: true, planPh: 'Plan: change the station, text a friend' },
  standard: { label: 'My standards',     tab: 'Standards',hint: "What you deserve next time. You're allowed to want more.", ph: 'Someone who texts back' },
  glowup:   { label: 'Glow-up goals',    tab: 'Glow-up',  hint: 'Pour the energy back into you.', ph: 'Run 3x this week', plan: true, planPh: 'Why it matters to me…' },
  memory:   { label: 'Memory box',       tab: 'Memories', hint: 'Keep or seal away what hurts to look at.', ph: 'The trip to the coast' },
};
const DELIVER_OPTS = [
  { d: 30,  label: 'in 1 month' },
  { d: 90,  label: 'in 3 months' },
  { d: 180, label: 'in 6 months' },
  { d: 365, label: 'in 1 year' },
];

let activeKind = 'reason';
let wired = false;
let data = { nc: null, roadmap: null, letters: [], items: [] };

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const root = () => document.getElementById('healing-root');

function fmtDays(ms) {
  const d = Math.floor(ms / 86400000);
  return d === 1 ? '1 day' : `${d} days`;
}
function ago(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days < 1) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}
function until(ts) {
  const ms = ts - Date.now();
  if (ms <= 0) return 'ready to open';
  const days = Math.ceil(ms / 86400000);
  return days === 1 ? 'opens tomorrow' : `opens in ${days} days`;
}

async function loadAll() {
  const [nc, roadmap, letters, items] = await Promise.all([
    window.api('/api/heartbreak/no-contact').catch(() => null),
    window.api('/api/heartbreak/roadmap').catch(() => null),
    window.api('/api/heartbreak/letters').catch(() => ({ letters: [] })),
    window.api(`/api/heartbreak/items?kind=${activeKind}`).catch(() => ({ items: [] })),
  ]);
  data = { nc, roadmap, letters: letters.letters || [], items: items.items || [] };
  render();
}

function ncCard() {
  const nc = data.nc;
  if (!nc || !nc.tracking) {
    return `<div class="card heal-card">
      <h3 class="heal-h">No-Contact Tracker</h3>
      <p class="heal-hint">Count the days you keep your distance. Every day is a win.</p>
      <input id="nc-label" class="heal-input" placeholder="who are you stepping back from? (optional)" maxlength="80"/>
      <button class="btn btn-accent heal-w" data-act="nc-start">Start day one</button>
    </div>`;
  }
  return `<div class="card heal-card nc-live">
    <h3 class="heal-h">No-Contact</h3>
    <div class="nc-count"><span class="nc-num">${nc.days}</span><span class="nc-unit">${nc.days === 1 ? 'day' : 'days'}</span></div>
    <p class="heal-hint nc-sub">${nc.label ? `away from ${esc(nc.label)} · ` : ''}longest: ${fmtDays(nc.longest_streak_ms)}${nc.reset_count ? ` · restarts: ${nc.reset_count}` : ''}</p>
    <div class="heal-row">
      <button class="btn btn-ghost" data-act="nc-reset">I broke no-contact</button>
      <button class="btn btn-ghost heal-quiet" data-act="nc-stop">Stop tracking</button>
    </div>
  </div>`;
}

function roadmapCard() {
  const r = data.roadmap;
  if (!r || !r.started) {
    return `<div class="card heal-card heal-muted">
      <h3 class="heal-h">Recovery roadmap</h3>
      <p class="heal-hint">Start the No-Contact tracker above to begin a gentle, day-by-day roadmap.</p>
    </div>`;
  }
  const dots = r.stages.map((s) =>
    `<div class="rm-stage ${s.reached ? 'reached' : ''} ${s.current ? 'current' : ''}" title="${esc(s.label)}">
      <span class="rm-dot"></span><span class="rm-label">${esc(s.label)}</span>
    </div>`).join('');
  return `<div class="card heal-card">
    <h3 class="heal-h">Recovery roadmap · day ${r.day}</h3>
    <div class="rm-now"><span class="rm-badge">${esc(r.stage_label)}</span></div>
    <p class="heal-task">${esc(r.task)}</p>
    <div class="rm-track">${dots}</div>
    ${r.next_stage_in_days != null ? `<p class="heal-hint" style="margin-top:8px">next chapter in ${r.next_stage_in_days} day${r.next_stage_in_days === 1 ? '' : 's'}</p>` : `<p class="heal-hint" style="margin-top:8px">you've come the whole way 🤍</p>`}
  </div>`;
}

function lettersCard() {
  const due = data.letters.filter((l) => l.due && !l.opened);
  const list = data.letters.map((l) => {
    if (l.due) {
      return `<div class="heal-item letter-due">
        <div class="heal-item-body">
          <strong>${esc(l.title || 'A letter to you')}</strong>
          ${l.body ? `<div class="letter-text">${esc(l.body)}</div>` : ''}
          <div class="heal-meta">${l.opened ? 'opened' : 'just arrived'}</div>
        </div>
        ${!l.opened ? `<button class="btn btn-accent heal-sm" data-act="letter-open" data-id="${l.id}">Open</button>` : `<button class="heal-x" data-act="letter-del" data-id="${l.id}">×</button>`}
      </div>`;
    }
    return `<div class="heal-item letter-locked">
      <div class="heal-item-body"><strong>🔒 ${esc(l.title || 'Sealed letter')}</strong>
        <div class="heal-meta">${until(l.deliver_at)}</div></div>
      <button class="heal-x" data-act="letter-del" data-id="${l.id}">×</button>
    </div>`;
  }).join('') || `<p class="heal-empty">No letters waiting yet.</p>`;

  return `<div class="card heal-card">
    <h3 class="heal-h">Letters to your future self ${due.length ? `<span class="heal-pill">${due.length} ready</span>` : ''}</h3>
    <p class="heal-hint">Write to who you'll be later. It stays sealed until the day arrives.</p>
    <textarea id="letter-body" class="heal-input" rows="3" placeholder="Dear future me, right now it hurts, but…" maxlength="5000"></textarea>
    <div class="heal-row">
      <select id="letter-when" class="heal-select">${DELIVER_OPTS.map((o) => `<option value="${o.d}">${o.label}</option>`).join('')}</select>
      <button class="btn btn-accent" data-act="letter-seal">Seal it</button>
    </div>
    <div class="heal-list">${list}</div>
  </div>`;
}

function itemsCard() {
  const k = KINDS[activeKind];
  const tabs = Object.entries(KINDS).map(([key, v]) =>
    `<button class="heal-tab ${key === activeKind ? 'on' : ''}" data-act="kind" data-kind="${key}">${v.tab}</button>`).join('');
  const list = data.items.map((it) => `
    <div class="heal-item ${it.sealed ? 'sealed' : ''}">
      <div class="heal-item-body">
        ${it.sealed ? '🔒 ' : ''}${it.title ? `<strong>${esc(it.title)}</strong> ` : ''}${esc(it.body)}
        ${it.plan ? `<div class="heal-plan">↳ ${esc(it.plan)}</div>` : ''}
        <div class="heal-meta">${ago(it.created_at)}</div>
      </div>
      <div class="heal-item-actions">
        ${activeKind === 'memory' ? `<button class="heal-mini" data-act="seal" data-id="${it.id}" data-sealed="${it.sealed}">${it.sealed ? 'unseal' : 'seal'}</button>` : ''}
        ${activeKind === 'glowup' ? `<button class="heal-mini ${it.done ? 'done' : ''}" data-act="done" data-id="${it.id}" data-done="${it.done}">${it.done ? '✓ done' : 'mark done'}</button>` : ''}
        <button class="heal-x" data-act="item-del" data-id="${it.id}">×</button>
      </div>
    </div>`).join('') || `<p class="heal-empty">${k.hint}</p>`;

  return `<div class="card heal-card">
    <div class="heal-tabs">${tabs}</div>
    <p class="heal-hint">${k.hint}</p>
    <input id="item-title" class="heal-input" placeholder="title (optional)" maxlength="120"/>
    <textarea id="item-body" class="heal-input" rows="2" placeholder="${k.ph}" maxlength="2000"></textarea>
    ${k.plan ? `<textarea id="item-plan" class="heal-input" rows="2" placeholder="${k.planPh}" maxlength="2000"></textarea>` : ''}
    <button class="btn btn-accent heal-w" data-act="item-add">Add to ${k.tab.toLowerCase()}</button>
    <div class="heal-list">${list}</div>
  </div>`;
}

function render() {
  const el = root();
  if (!el) return;
  el.innerHTML = ncCard() + roadmapCard() + lettersCard() + itemsCard();
}

async function call(path, opts, okMsg) {
  try {
    const r = await window.api(path, opts);
    if (okMsg) window.toast && window.toast(okMsg, 'good');
    return r;
  } catch (e) {
    window.toast && window.toast(e.message || 'Something went wrong', 'error');
    throw e;
  }
}

function wire() {
  if (wired) return;
  wired = true;
  const el = root();

  el.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const id = btn.dataset.id;

    if (act === 'kind') { activeKind = btn.dataset.kind; await loadAll(); return; }

    if (act === 'nc-start') {
      const label = (document.getElementById('nc-label')?.value || '').trim();
      await call('/api/heartbreak/no-contact', { method: 'POST', body: { label: label || null } }, 'Day one. You\'ve got this. 🤍');
      return loadAll();
    }
    if (act === 'nc-reset') {
      if (!confirm('Reset the counter? No judgement — tomorrow is day one again.')) return;
      await call('/api/heartbreak/no-contact/reset', { method: 'POST', body: {} }, 'Reset. Be gentle with yourself.');
      return loadAll();
    }
    if (act === 'nc-stop') {
      if (!confirm('Stop tracking no-contact?')) return;
      await call('/api/heartbreak/no-contact', { method: 'DELETE' }, 'Stopped.');
      return loadAll();
    }

    if (act === 'item-add') {
      const body = (document.getElementById('item-body')?.value || '').trim();
      if (!body) { window.toast && window.toast('Write something first.', 'info'); return; }
      const title = (document.getElementById('item-title')?.value || '').trim();
      const plan = (document.getElementById('item-plan')?.value || '').trim();
      await call('/api/heartbreak/items', { method: 'POST', body: { kind: activeKind, title: title || null, body, plan: plan || null } }, 'Added.');
      return loadAll();
    }
    if (act === 'item-del') {
      await call(`/api/heartbreak/items/${id}`, { method: 'DELETE' });
      return loadAll();
    }
    if (act === 'seal') {
      const sealed = btn.dataset.sealed === '1';
      await call(`/api/heartbreak/items/${id}`, { method: 'PATCH', body: { sealed: !sealed } });
      return loadAll();
    }
    if (act === 'done') {
      const done = btn.dataset.done === '1';
      await call(`/api/heartbreak/items/${id}`, { method: 'PATCH', body: { done: !done } });
      return loadAll();
    }

    if (act === 'letter-seal') {
      const body = (document.getElementById('letter-body')?.value || '').trim();
      if (!body) { window.toast && window.toast('Write your letter first.', 'info'); return; }
      const days = parseInt(document.getElementById('letter-when')?.value || '90', 10);
      await call('/api/heartbreak/letters', { method: 'POST', body: { body, deliver_in_days: days } }, 'Sealed. It\'ll find you later. ✉️');
      return loadAll();
    }
    if (act === 'letter-open') {
      const r = await call(`/api/heartbreak/letters/${id}/open`, { method: 'POST', body: {} });
      if (r && r.body) {
        await loadAll();
        window.toast && window.toast('A letter from your past self 🤍', 'good');
      }
      return;
    }
    if (act === 'letter-del') {
      if (!confirm('Delete this letter?')) return;
      await call(`/api/heartbreak/letters/${id}`, { method: 'DELETE' });
      return loadAll();
    }
  });
}

export async function init() {
  wire();
  await loadAll();
}
