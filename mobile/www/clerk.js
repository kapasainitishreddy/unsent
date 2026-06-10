// Clerk frontend integration for unsent
// loads Clerk's headless bundle, mounts <SignIn>, exposes session token.
// falls back to a paste-token dev panel if no publishable key is set.

const TOKEN_KEY = 'unsent_clerk_token';
const KEY_CONFIG = 'unsent_clerk_publishable_key';

export function getClerkToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

export function setClerkToken(t) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
  window.dispatchEvent(new CustomEvent('clerk:token-changed', { detail: { token: t } }));
}

function getPublishableKey() {
  // window override (set via inline script or dev panel) takes precedence
  return (window.CLERK_PUBLISHABLE_KEY || localStorage.getItem(KEY_CONFIG) || '').trim();
}

export function setPublishableKey(k) {
  if (k) localStorage.setItem(KEY_CONFIG, k);
  else localStorage.removeItem(KEY_CONFIG);
  window.CLERK_PUBLISHABLE_KEY = k || '';
}

export function initClerk() {
  const mount = document.getElementById('clerkMount');
  const pasteRow = document.getElementById('clerkPasteRow');
  const tokenInput = document.getElementById('clerkTokenInput');
  const tokenSave = document.getElementById('clerkTokenSave');
  const tokenClear = document.getElementById('clerkTokenClear');
  const keyInput = document.getElementById('clerkKeyInput');
  const keySave = document.getElementById('clerkKeySave');
  const status = document.getElementById('clerkStatus');
  const signOut = document.getElementById('clerkSignOut');

  if (!mount) return; // not on the account tab

  // Always show the paste-token + key rows (dev panel)
  if (pasteRow) pasteRow.hidden = false;
  if (tokenInput) tokenInput.value = getClerkToken() || '';

  if (tokenSave) tokenSave.addEventListener('click', () => {
    const t = (tokenInput.value || '').trim();
    setClerkToken(t);
    if (status) status.textContent = t ? 'Token saved. Reloading…' : 'Token cleared. Reloading…';
    setTimeout(() => location.reload(), 500);
  });

  if (tokenClear) tokenClear.addEventListener('click', () => {
    setClerkToken(null);
    if (tokenInput) tokenInput.value = '';
    if (status) status.textContent = 'Token cleared. Reloading…';
    setTimeout(() => location.reload(), 500);
  });

  if (keyInput) {
    keyInput.value = getPublishableKey();
    if (keySave) keySave.addEventListener('click', () => {
      const k = (keyInput.value || '').trim();
      setPublishableKey(k);
      if (status) status.textContent = k ? 'Key saved. Reloading…' : 'Key cleared. Reloading…';
      setTimeout(() => location.reload(), 1000);
    });
  }

  if (signOut) signOut.addEventListener('click', async () => {
    if (window.Clerk && window.Clerk.session) {
      try { await window.Clerk.signOut(); } catch (e) { /* ignore */ }
    }
    setClerkToken(null);
    if (status) status.textContent = 'Signed out. Reloading…';
    setTimeout(() => location.reload(), 500);
  });

  const pk = getPublishableKey();
  if (!pk) {
    if (status) status.textContent = 'Dev mode (auto-login as local_user). Paste a Clerk JWT above to test real auth, or set a publishable key.';
    return;
  }

  // Load Clerk headless bundle
  if (status) status.textContent = 'Loading Clerk…';
  const s = document.createElement('script');
  s.src = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';
  s.async = true;
  s.crossOrigin = 'anonymous';
  s.dataset.clerkPublishableKey = pk;
  s.onload = async () => {
    try {
      await window.Clerk.load();
      if (window.Clerk.user) {
        const tok = await window.Clerk.session?.getToken();
        if (tok) setClerkToken(tok);
      }
      mountClerkWidget();
    } catch (e) {
      if (status) status.textContent = 'Clerk failed to load: ' + e.message;
    }
  };
  s.onerror = () => {
    if (status) status.textContent = 'Clerk bundle failed to download. Check your network or paste a JWT manually.';
  };
  document.head.appendChild(s);
}

function mountClerkWidget() {
  const mount = document.getElementById('clerkMount');
  const status = document.getElementById('clerkStatus');
  if (!mount || !window.Clerk) return;

  mount.innerHTML = '';
  const clerk = window.Clerk;

  if (clerk.user) {
    mount.innerHTML = `
      <div class="clerk-user">
        <div class="clerk-avatar">${(clerk.user.firstName || 'U')[0].toUpperCase()}</div>
        <div>
          <div class="clerk-name">${clerk.user.fullName || clerk.user.primaryEmailAddress?.emailAddress || 'Signed in'}</div>
          <div class="clerk-sub">${clerk.user.primaryEmailAddress?.emailAddress || ''}</div>
        </div>
      </div>`;
    if (status) status.textContent = 'Signed in. Token auto-attached to every request.';
    return;
  }

  // Build a minimal sign-in form using Clerk's openSignIn
  const btn = document.createElement('button');
  btn.className = 'btn primary clerk-signin-btn';
  btn.textContent = 'Open sign-in';
  btn.addEventListener('click', () => clerk.openSignIn({ afterSignInUrl: window.location.href }));
  mount.appendChild(btn);
  if (status) status.textContent = 'Clerk ready. Click the button to sign in.';
}
