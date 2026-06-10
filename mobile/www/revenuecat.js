// RevenueCat in-app subscription integration for the Capacitor shell.
// In the browser/web (no Capacitor) this is a no-op — premium is flipped
// only when the native binary receives a real purchase event.
//
// Flow:
//   1. App boots → RC.configure({ apiKey })
//   2. RC.getCustomerInfo() → check entitlement 'premium'
//   3. If entitled, call PUT /api/settings with { premium: true, premium_source: 'revenuecat', premium_expires_at }
//   4. On purchase, RC fires 'purchases:updated' → flip the setting
//   5. On restore, restore the setting
//
// Server-side: RevenueCat webhook → POST /api/billing/webhook → flip settings.premium
//   (see backend/src/routes/billing.js)
//
// This module also exposes a stubbed "Upgrade" flow that opens the native
// paywall when running inside Capacitor, or a polite "available on mobile"
// toast in the browser.

const RC_KEY = window.REVENUECAT_PUBLIC_KEY || null;
const ENTITLEMENT = 'premium';

let _purchases = null;
let _configured = false;

async function getPurchases() {
  if (_purchases) return _purchases;
  if (typeof window.Capacitor === 'undefined' || !window.Capacitor.isNativePlatform) {
    return null;
  }
  if (!RC_KEY) {
    console.warn('RevenueCat: no public key set (REVENUECAT_PUBLIC_KEY) — paywall disabled');
    return null;
  }
  try {
    const mod = await import(/* @vite-ignore */ '@revenuecat/purchases-capacitor');
    _purchases = mod.Purchases;
    return _purchases;
  } catch (e) {
    console.warn('RevenueCat plugin not available:', e.message);
    return null;
  }
}

async function configure() {
  if (_configured) return;
  const Purchases = await getPurchases();
  if (!Purchases) return;
  try {
    await Purchases.configure({ apiKey: RC_KEY });
    _configured = true;
    // sync entitlement on first run
    await syncEntitlement();
    // listen for changes
    Purchases.addCustomerInfoUpdateListener(() => syncEntitlement());
  } catch (e) {
    console.error('RevenueCat configure failed:', e);
  }
}

async function syncEntitlement() {
  const Purchases = await getPurchases();
  if (!Purchases) return;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    const has = customerInfo?.entitlements?.active?.[ENTITLEMENT] != null;
    const exp = customerInfo?.entitlements?.active?.[ENTITLEMENT]?.expirationDate || null;
    if (typeof window.api === 'function') {
      await window.api('/api/settings', {
        method: 'PATCH',
        body: {
          premium: has ? 1 : 0,
          premium_source: has ? 'revenuecat' : null,
          premium_expires_at: exp,
        },
      });
      window.dispatchEvent(new CustomEvent('premium:changed', { detail: { premium: !!has } }));
    }
  } catch (e) {
    console.warn('RevenueCat syncEntitlement:', e);
  }
}

async function presentPaywall() {
  const Purchases = await getPurchases();
  if (!Purchases) {
    if (typeof window.toast === 'function') {
      window.toast('Upgrade is available in the iOS/Android app — see the Account tab for the link.', 'good');
    }
    return;
  }
  try {
    // showPaywall throws if no offering is configured in the RC dashboard
    const { customerInfo } = await Purchases.getCustomerInfo();
    const isPremium = customerInfo?.entitlements?.active?.[ENTITLEMENT] != null;
    if (isPremium) {
      if (typeof window.toast === 'function') window.toast('You are already on Premium ✨', 'good');
      return;
    }
    // best-effort: call getOfferings and show the first
    const { offerings } = await Purchases.getOfferings();
    const current = offerings?.current;
    if (current?.availablePackages?.length) {
      const pkg = current.availablePackages[0];
      const { customerInfo: after } = await Purchases.purchasePackage({ aPackage: pkg });
      if (after?.entitlements?.active?.[ENTITLEMENT] != null) {
        await syncEntitlement();
        if (typeof window.toast === 'function') window.toast('Welcome to Premium ✨', 'good');
      }
    } else {
      if (typeof window.toast === 'function') window.toast('No offerings configured in RevenueCat yet.', 'error');
    }
  } catch (e) {
    if (e?.userCancelled) return;
    console.error('RevenueCat purchase failed:', e);
    if (typeof window.toast === 'function') window.toast('Purchase failed: ' + e.message, 'error');
  }
}

async function restore() {
  const Purchases = await getPurchases();
  if (!Purchases) {
    if (typeof window.toast === 'function') window.toast('Restore is available in the mobile app.', 'good');
    return;
  }
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    const has = customerInfo?.entitlements?.active?.[ENTITLEMENT] != null;
    await syncEntitlement();
    if (typeof window.toast === 'function') {
      window.toast(has ? 'Premium restored ✨' : 'No active subscription found.', 'good');
    }
  } catch (e) {
    console.error('RevenueCat restore failed:', e);
    if (typeof window.toast === 'function') window.toast('Restore failed: ' + e.message, 'error');
  }
}

export const revenuecat = { configure, syncEntitlement, presentPaywall, restore };
export default revenuecat;
