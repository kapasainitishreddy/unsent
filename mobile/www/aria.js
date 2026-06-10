// Aria settings — rename, mascot, voice, pitch, rate.
// Persists via PATCH /api/settings.

const MASCOTS = ['crane', 'moon', 'feather', 'leaf', 'wave', 'sprout'];
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

let settings = null;
let voices = [];

async function load() {
  try {
    settings = await window.api('/api/settings');
  } catch (e) { return; }
  paint();
  wire();
  loadVoices();
}

function paint() {
  if (!settings) return;
  $('#ariaNameLabel').textContent = settings.aria_name || 'Aria';
  $('#ariaMascotLabel').textContent = settings.aria_mascot || 'crane';
  $('#ariaNameInput').value = settings.aria_name || 'Aria';
  $('#ariaPitch').value = settings.voice_pitch || 1;
  $('#ariaRate').value  = settings.voice_rate  || 1;
  $('#ariaPitchVal').textContent = (+settings.voice_pitch || 1).toFixed(1);
  $('#ariaRateVal').textContent  = (+settings.voice_rate  || 1).toFixed(1);

  // mascot avatar slot
  const slot = $('#ariaAvatarSlot');
  if (slot && window.mascot) {
    slot.innerHTML = window.mascot(settings.aria_mascot || 'crane', false);
  }

  // mascot grid
  const grid = $('#ariaMascotGrid');
  if (grid) {
    grid.innerHTML = MASCOTS.map(m => `
      <button class="mascot-tile ${settings.aria_mascot === m ? 'picked' : ''}" data-m="${m}" title="${m}">
        <span data-mascot-slot="${m}"></span>
      </button>
    `).join('');
    MASCOTS.forEach(m => {
      const slot = grid.querySelector(`[data-mascot-slot="${m}"]`);
      if (slot && window.mascot) slot.innerHTML = window.mascot(m, false);
    });
  }
}

function wire() {
  // name save
  $('#ariaNameSave').addEventListener('click', async () => {
    const name = $('#ariaNameInput').value.trim() || 'Aria';
    await window.api('/api/settings', { method: 'PATCH', body: { aria_name: name } });
    settings.aria_name = name;
    paint();
    window.toast && window.toast('Aria is now ' + name, 'good');
  });

  // mascot pick
  $('#ariaMascotGrid').addEventListener('click', async e => {
    const tile = e.target.closest('.mascot-tile');
    if (!tile) return;
    const m = tile.dataset.m;
    await window.api('/api/settings', { method: 'PATCH', body: { aria_mascot: m } });
    settings.aria_mascot = m;
    paint();
    window.toast && window.toast('Form changed to ' + m, 'good');
  });

  // pitch slider
  $('#ariaPitch').addEventListener('input', e => {
    const v = +e.target.value;
    $('#ariaPitchVal').textContent = v.toFixed(1);
  });
  $('#ariaPitch').addEventListener('change', async e => {
    const v = +e.target.value;
    await window.api('/api/settings', { method: 'PATCH', body: { voice_pitch: v } });
    settings.voice_pitch = v;
  });

  // rate slider
  $('#ariaRate').addEventListener('input', e => {
    const v = +e.target.value;
    $('#ariaRateVal').textContent = v.toFixed(1);
  });
  $('#ariaRate').addEventListener('change', async e => {
    const v = +e.target.value;
    await window.api('/api/settings', { method: 'PATCH', body: { voice_rate: v } });
    settings.voice_rate = v;
  });

  // voice test (browser TTS)
  $('#ariaVoiceTest').addEventListener('click', () => testVoice());

  // redo onboarding
  $('#resetOnboardingBtn').addEventListener('click', async () => {
    if (!confirm('Redo the introduction? This will not delete your data.')) return;
    await window.api('/api/settings', { method: 'PATCH', body: { onboarding_complete: false } });
    location.reload();
  });
}

function loadVoices() {
  if (!window.speechSynthesis) return;
  const sel = $('#ariaVoiceSelect');
  const update = () => {
    voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    sel.innerHTML = '<option value="">(system default)</option>' +
      voices.map(v => `<option value="${v.voiceURI}" ${settings.aria_voice === v.voiceURI ? 'selected' : ''}>${v.name} (${v.lang})</option>`).join('');
  };
  update();
  if (window.speechSynthesis.onvoiceschanged !== undefined) {
    window.speechSynthesis.onvoiceschanged = update;
  }
  sel.addEventListener('change', async () => {
    const uri = sel.value || null;
    await window.api('/api/settings', { method: 'PATCH', body: { aria_voice: uri } });
    settings.aria_voice = uri;
    window.toast && window.toast('Voice saved', 'good');
  });
}

function testVoice() {
  if (!window.speechSynthesis) { window.toast && window.toast('No TTS in this browser', 'error'); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(`Hi. I'm ${settings.aria_name || 'Aria'}. I'm here when you need me.`);
  const v = voices.find(v => v.voiceURI === settings.aria_voice);
  if (v) u.voice = v;
  u.pitch = settings.voice_pitch || 1;
  u.rate  = settings.voice_rate  || 1;
  window.speechSynthesis.speak(u);
}

export async function init() { await load(); }

// re-paint if onboarding completes
window.addEventListener('onboarding:complete', () => { load(); });
