# End-to-end encrypted sync — design

Status: **proposed** (not yet implemented). This doc is the plan; nothing in
the app currently syncs — all data stays in the local SQLite DB.

## Goal

Let a user opt in to syncing their entries (vents, unsent, journal, mood,
gratitude, heartbreak items/letters) across devices, such that **the server
never sees plaintext**. Supabase stores only ciphertext; decryption happens on
the device with a key the server never holds.

## Threat model

- We protect entry **content** from the server/database operator and from
  anyone who reads the Supabase tables.
- We do **not** hide metadata that sync needs: row id, user id, table name,
  `created_at`, and an opaque `kind` tag are stored in clear for ordering and
  conflict resolution.
- Losing the key = losing the data. This is the explicit trade for zero-
  knowledge. The UX must make that consequence unmissable.

## Key model (decision required — see bottom)

Two viable options:

1. **Passphrase-derived key** — user sets a sync passphrase. Derive a 256-bit
   key with Argon2id (or PBKDF2-SHA256, ≥600k iters as fallback) + a per-user
   random salt stored in Supabase. Key lives only in memory + device secure
   storage. Simple, no extra accounts; forgotten passphrase = unrecoverable.
2. **Device keypair + wrapped data key** — generate a random data key per user,
   wrap it per device public key. Smoother multi-device, but needs a device-
   pairing flow. More moving parts.

Recommendation: **start with (1)**, passphrase-derived, behind an opt-in.

## Crypto

- Content cipher: **AES-256-GCM** via WebCrypto (`crypto.subtle`), random
  96-bit IV per record, IV prepended to ciphertext.
- Each record stored as `{ iv, ciphertext, alg: "A256GCM", v: 1 }` (base64).
- Key derivation params and salt versioned so we can rotate later.

## Supabase schema (per synced table, e.g. `sync_entries`)

```
id           uuid primary key            -- mirrors local id
user_id      uuid not null               -- = auth.uid()
kind         text not null               -- 'vent' | 'unsent' | 'journal' | ...
payload      jsonb not null              -- { iv, ciphertext, alg, v }  (opaque)
created_at   timestamptz not null
updated_at   timestamptz not null
deleted_at   timestamptz                 -- soft delete (tombstone)
```

RLS (mandatory):
```
alter table sync_entries enable row level security;
create policy "own rows" on sync_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## Sync protocol (last-write-wins, tombstoned)

- **Push**: encrypt new/changed local rows → upsert into `sync_entries`.
- **Pull**: `select * where updated_at > last_pulled_at` → decrypt → merge.
- Conflicts resolved by `updated_at` (LWW). Deletes are tombstones, never hard
  deletes, so they propagate.
- A local `sync_state` table tracks `last_pulled_at` and dirty rows.

## App integration

- New setting `sync_enabled` + `sync_salt` (Supabase) and a device-stored key.
- A `mobile/www/sync.js` module: `enableSync(passphrase)`, `push()`, `pull()`,
  `disableSync()`. Triggered after writes (debounced) and on app focus.
- Auth: reuse the existing Clerk → Supabase JWT path so `auth.uid()` is set.

## Rollout / safety

- Strictly opt-in; default off. Plaintext local DB remains the source of truth.
- Ship behind a flag; verify round-trip (encrypt→store→fetch→decrypt) in tests
  with a known vector before exposing the toggle.
- The crypto core gets its own review pass (`/security-review`) before merge.

---

## Decisions needed before implementation

1. **Supabase project**: connect an existing project, or create a new one?
   (The MCP call to list/create projects needs your approval.)
2. **Key model**: passphrase-derived (recommended) or device-keypair?
3. **Lost-key UX**: confirm we accept "forgotten passphrase = unrecoverable
   data" (the price of zero-knowledge), with a clear warning at opt-in.
