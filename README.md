# Unsent

A private place to say what you can't send.

Unsent is a journaling and venting app with an AI companion (Aria) that listens and remembers, crisis-detection on every message, and a native iOS + Android shell built with Capacitor around the same web client.

**This is a monorepo.** It contains the API server and the mobile client in one git history.

```
unsent/
├── backend/         # Fastify API + SQLite + Clerk auth
│   ├── src/
│   │   ├── server.js       # boot, auth preHandler, /api/* routes
│   │   ├── auth.js         # Clerk token verify + dev-mode fallback
│   │   ├── db/             # SQLite schema + connection
│   │   ├── routes/         # 14 route files (vents, unsent, journal, mood, billing, ...)
│   │   ├── presets.js      # 15 affirmation presets, shared
│   │   ├── seed.js         # `pnpm seed` CLI, idempotent
│   │   └── util.js         # withParams, withBody, free-vent quota helpers
│   ├── tests/              # node:test, 42 tests, 100% passing
│   ├── package.json
│   └── README.md           # backend-specific docs
└── mobile/          # Web client + native shell
    ├── www/                # index.html, app.js, voice.js, clerk.js, revenuecat.js, onboarding.js, aria.js (no build)
    ├── android/            # Capacitor Android project — open in Android Studio
    ├── ios/                # Capacitor iOS project — open in Xcode (Mac only)
    ├── capacitor.config.json
    └── package.json
```

## Quick start

```bash
# 1. Install backend deps
cd backend && pnpm install

# 2. Start the API in dev mode (auto-authenticates as `local_user`)
pnpm dev
# → http://127.0.0.1:4000
# → demo client at http://127.0.0.1:4000/app/

# 3. Seed the 15 affirmation presets (idempotent)
pnpm seed

# 4. Run the test suite (42 tests)
pnpm test
```

To use real Clerk auth, copy `backend/.env.example` to `backend/.env` and set:

```
CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

Restart the server. With both keys set, the server fails closed — no token returns 401.

## API surface

| Endpoint | Auth | Notes |
|---|---|---|
| `GET  /api/health` | public | liveness |
| `GET  /api/me` | auth | user id, auth mode, premium status |
| `GET  /api/meta` | public | static option lists (moods, skin, hair, glasses, expressions, coping tools, affirmation mood filters) |
| `GET  /` | public | endpoint list, auth mode, version |
| `GET  /app/` | public | the demo web client (static) |
| `GET  /api/avatar` | auth | returns the user's avatar with `meta: { skin, hair, glasses, expressions }` under a separate `meta` key so saved values aren't shadowed by the option arrays |
| `PATCH /api/avatar` | auth | skin tone, hair color, glasses, expression |
| `GET/POST /api/vents` | auth | 3/day free quota; premium = unlimited |
| `GET  /api/unsent?outcome=&shape=` | auth | filterable |
| `GET  /api/journal` | auth | 12 most recent vents + unsent messages feed Aria's memory |
| `GET  /api/mood` | auth | mood check-ins with `intensity` |
| `GET  /api/affirmations?mood=` | auth | filterable by mood_filter |
| `GET  /api/intentions` | auth | toggle daily intentions |
| `GET  /api/coping` | auth | coping session log |
| `POST /api/ai/companion` | auth | mock provider by default; wire your own OpenAI key in `src/server.js` or point at 9router (http://127.0.0.1:9545) |
| `POST /api/ai/crisis-check` | auth | flags suicidal/self-harm content, returns 988 resources |
| `GET  /api/export` | auth | full JSON bundle of user data |
|| `POST /api/wipe` | auth | requires `confirm: "DELETE"` in body |
|| `POST /api/billing/webhook` | public | RevenueCat server-to-server; flip `settings.premium` on subscription lifecycle events |

## Mobile (Capacitor)

The web client is a single `index.html` + `app.js` (no build step). Capacitor wraps it as a native iOS/Android app.

```bash
cd mobile
npm install
npx cap sync            # copies www/ + plugin config into android/ and ios/
npx cap open android    # opens in Android Studio
npx cap open ios        # opens in Xcode (Mac only)
```

**In dev**, the Capacitor config points at `http://10.0.2.2:4000/app/` (Android emulator's host loopback) so the app live-reloads from the Fastify server. For iOS dev, change `server.url` in `capacitor.config.json` to your Mac's LAN IP.

**For production builds**, remove the `server` block from `capacitor.config.json` and run `npx cap sync` to bundle the web assets.

### Onboarding (first-run)

When a fresh user lands on the app, a 4-step overlay walks them through: name → mascot (Crane / Moon / Feather / Leaf / Wave / Sprout) → purpose (Releases / Patterns / Quiet / Custom) → mood. Answers persist via `PATCH /api/settings` (`user_display_name`, `onboarding_mascot`, `onboarding_purpose`, `onboarding_mood`, `onboarding_complete`). Re-do from Account → "Redo intro".

### Aria (AI companion)

The Account tab has an Aria settings card: rename Aria, pick her mascot, choose her TTS voice (from browser `speechSynthesis.getVoices()`), set pitch + rate, test the voice. All persisted via `PATCH /api/settings` (`aria_name`, `aria_mascot`, `aria_voice`, `voice_pitch`, `voice_rate`).

### In-app purchases (RevenueCat)

Premium is gated on `settings.premium` (already wired into the vent quota). The native shell uses `@revenuecat/purchases-capacitor` for actual purchases; the browser build shows a friendly toast and the upgrade button stays disabled.

**To enable IAP:**

1. **Sign up at revenuecat.com** (free tier available). Create a new project.
2. **Create a product** in the App Store Connect and Google Play Console with id `unsent_premium_monthly` at $4.99/mo.
3. **In RevenueCat**, link the products to your app, set the entitlement id to `premium`.
4. **In your mobile app's** `capacitor.config.json` or a build-time env, set:
   ```bash
   REVENUECAT_PUBLIC_KEY=appl_xxx (iOS) / goog_xxx (Android)
   ```
5. **Configure the webhook** in RevenueCat: Project → Integrations → Webhooks → Add Endpoint:
   - URL: `https://<your-api-host>/api/billing/webhook`
   - Events: `INITIAL_PURCHASE`, `RENEWAL`, `PRODUCT_CHANGE`, `CANCELLATION`, `BILLING_ISSUE`
   - (Optional) Set a shared secret in the Authorization header, then mirror it in your backend `.env` as `REVENUECAT_WEBHOOK_SECRET`.
6. **Map users**: in `mobile/www/revenuecat.js` configure with `appUserID: clerkUserId` so RC can attribute receipts to settings rows.
7. **Build the native binary** (see CI section below) and submit to the stores.

### Continuous integration (GitHub Actions)

`.github/workflows/mobile-build.yml` runs on every push to `main`:

- **`test`** — runs the 42-test backend suite on every PR, fails the build on regression.
- **`android`** — builds a signed `.aab` (release) on every push. Uploads the artifact for 14 days.
- **`ios`** — manual `workflow_dispatch` only (needs macOS + Xcode). Builds a signed `.ipa` via `fastlane match`. Required secrets: `APPLE_TEAM_ID`, `APPLE_API_KEY_ID`, `APPLE_API_KEY_BASE64`, `MATCH_PASSWORD`, `MATCH_GIT_URL`, `MATCH_DEPLOY_KEY`.

Configure secrets in the GitHub repo's Settings → Secrets and variables → Actions. See the workflow file for the full list.

**To build locally instead of via CI:**

Android:
```bash
cd mobile
npx cap sync android
cd android
./gradlew bundleRelease    # produces app/build/outputs/bundle/release/app-release.aab
```

iOS (Mac only):
```bash
cd mobile
npx cap sync ios
cd ios/App
pod install
open App.xcworkspace       # then Product → Archive in Xcode
```

### Native features wired in

- Microphone permission requested at first voice input
- `RECORD_AUDIO` (Android) + `NSMicrophoneUsageDescription` (iOS) declared in native manifests with copy explaining audio is transcribed on-device
- `@capacitor-community/speech-recognition` for STT (native, on-device)
- `@capacitor-community/text-to-speech` for TTS (Aria can read her replies out loud)
- `@capacitor/haptics` — light haptic on voice start
- `@capacitor/status-bar` — matches the warm paper background
- `@capacitor/splash-screen` — 800ms launch screen
- `@capacitor/preferences` — Clerk token persistence across launches
- `@capacitor/app` — handles back button + deep links on Android
- `@capacitor/keyboard` — respects safe areas

## Features

- **Vents** — free-tier daily quota, premium bypass, mood + intensity, mark released
- **Unsent messages** — letters you'll never send, mark as "sent" or "deleted"
- **Journal** — private entries with optional mood, searchable
- **Mood** — check-ins with intensity, trendable
- **Affirmations** — 15 presets seeded, favorite + filter by mood
- **Intentions** — daily tiny goals, toggleable
- **Coping** — log what tool you used + was it helpful
- **Aria (companion)** — AI that remembers the last 12 vents/unsent (never journal/mood), crisis-detects every message, gives 988 resources on flag
- **Avatar** — symbolic SVG avatar with skin/hair/glasses/expression, drawn in code
- **Voice** — Web Speech API in browser, native plugin on mobile, with TTS for Aria's replies
- **Theme** — light + warm dark, system preference detection
- **Export + wipe** — full data portability, one-call account destruction
- **Clerk** — headless bundle on the frontend, paste-a-JWT dev mode, fail-closed on the backend

## Tested

42/42 tests passing via `node:test` + `app.inject()`. No external test runner.

```
ℹ tests 42
ℹ pass 42
ℹ fail 0
```

## Stack

- **Backend**: Node 22, Fastify 5, SQLite (built-in `node:sqlite`), Clerk, zod, pnpm
- **Client**: vanilla HTML/CSS/JS, no build step
- **Mobile**: Capacitor 8, @capacitor-community/speech-recognition, @capacitor-community/text-to-speech, @revenuecat/purchases-capacitor
- **Tests**: node:test with Fastify's `app.inject()`

## What's not done (yet)

- Real voice test end-to-end (the code is wired but I never spoke into a mic in this session)
- Real IAP end-to-end (needs your Apple/Google developer accounts + a published RC product)
- 9router for free AI — the companion is currently in mock mode
- Nango for third-party integrations — not needed yet
