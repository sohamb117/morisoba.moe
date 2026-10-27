# Mimori protocol implementation

Status: experimental Mimori preview, authorized for hosting at `https://morisoba.moe/mimori/`, implementing [Draft 0.1](https://chatgpt.com/space/page_9fefb250d03c8191a141dd2bac4d3663). This branch is not a production protocol release. The existing feed, authentication, accounts, and database remain in place. The preview uses its own database; hosting it does not migrate or publish existing posts. Registration on morisoba.moe remains invite-only.

## Data preservation

Before implementation, a read-only snapshot of production was saved outside the repository with owner-only file permissions. It contains 4 users, 16 posts (including any retained soft-deleted rows), 5 invitations, 5 sessions, 5 rate-limit entries and the migration record. Its SHA-256 checksum, SQLite integrity check, foreign keys, and every table count were verified by restoring into an isolated in-memory database. The backup contains private data and must never be committed or served as an asset.

The protocol has a separate `MIMORI_PROTOCOL_DB` binding and migration directory. Its migration creates new tables only. The deployment configuration supplies this separate binding and `MIMORI_PROTOCOL_ENABLED=true`. The original `MIMORI_DB` binding is unchanged. The legacy middleware change only exports its existing session reader for the first provider's authentication adapter.

`GET /api/mimori/v1/legacy-export` requires the existing user's session and returns only their own posts and profile. `client.importLegacy(selectedIds)` requires an explicit selection, excludes deleted posts, marks imports with original provenance, deduplicates them, and never updates or deletes the legacy rows. Enrollment does not call it.

## Implemented

- Provider-independent, content-addressed Ed25519 identities and signed canonical records. Identity updates require an atomic previous-hash/revision match.
- Browser-generated keys. Argon2id (64 MiB, 3 passes, 4 lanes) wraps a random vault master key; AES-256-GCM protects vault contents. Password changes can rewrap the master key without rewriting content. Vault reads are private and updates use compare-and-swap.
- Public ciphertext object and envelope reads, explicit public profiles, protected profile events, provider discovery, and signed cross-provider one-time-prekey claims.
- Mutual signed keyring request/acceptance. Claiming a prekey requires acceptance; revoked relationships cannot claim. EC and KEM prekey IDs cannot be republished for the same identity/device.
- A pinned OpenE2EE 13.2.0 ratchet adapter. Actual encrypted exchange, reordering, replay rejection, and authenticated prekey certificates are exercised in tests. No custom ratchet algorithm is implemented here.
- Encrypted IndexedDB storage through the SDK's key-value adapter. Its 16-case backend conformance suite includes reopen/durability. Web Locks and an atomic snapshot commit keep ratchet advancement, application state, outbox ciphertext and replay progress together. Failed operations discard staged state. Network retries reuse committed bytes.
- Protected posts, profile events, replies, likes and like removals. Likes are deduplicated per identity and remove-before-add works. Reply/like fanout through the root author's client preserves the original signature and checks the signed audience. The coordinator must be online to forward.
- Optional mentions are stable identity IDs inside encrypted events; they cannot expand the audience.
- `Share older posts` defaults off. A confirmed job has a fixed manifest/cutoff, visits only the author's own nondeleted posts, wraps archived keys in fresh ratchet envelopes, persists its cursor, supports pause/resume, and creates read-only history grants. It does not replay other people's replies or likes. The ciphertext body is reused.
- A separate browser preview at `/mimori/`, retaining the existing page's fonts and layout. Existing accounts sign in before explicit protocol enrollment. The main `/mimorigasaka/` page is unchanged.

## Suite and implementation limits

The draft has not frozen its wire suite. The installed SDK requires PQXDH plus its braid ratchet, rather than the draft's proposed classical X3DH suite. The implementation therefore uses the explicit identifier `mimori-open-e2ee-13.2.0-experimental`; it is not advertised as compatible with a finalized Mimorigasaka or Signal wire protocol. The root currently signs social records; a separately delegated device-signing certificate format is still needed before freezing the wire format.

Sign-in now uses the provider username and password for both account authentication and client-side vault decryption. New identities and their encrypted vaults are enrolled atomically. Account password changes rewrap the same vault master key, retaining a private encrypted previous wrapper as a cross-database crash-recovery fallback. Passwords are not stored in browser storage.

Each browser automatically registers a distinct transport device. Existing local device 1 and its ratchet state are preserved. New devices use the SDK at a device-specific transport address (`account-id/device/N`, SDK device 1); their independent transport keys are certified by the stable account's signed prekey record with `addressing: per-device-v1`. Envelopes specify the recipient device and, when not 1, the sender device. This avoids copying or rolling back live ratchet states across browsers. The experimental suite requires updated clients for new-device envelopes; device 1 wire addresses remain unchanged. Public device discovery allows fanout to every registered device with published prekeys. Device retirement and independent security review remain outstanding.

Encrypted archives contain own posts and, from this release onward, received events and history grants. New browsers restore those archives using the same account password, with signature and audience validation. Already-received events that only existed in an older browser cannot be reconstructed remotely until that browser syncs/backs them up; no old ratchet is reset to pretend otherwise. Original feed posts remain in the original database and appear in the signed-in viewer without republishing them. Invitations remain on the existing invite-only provider account system.

The client supports signed tombstones and deletion, but edit/delete controls, attachment/avatar transport, rejected/blocked keyring states, re-adding a removed partner, and the complete migration selection UI are not implemented. Public profile publication is available at the record layer, not exposed in the preview. The preview's partner identity verification is a direct key-ID comparison, not a polished fingerprint verification ceremony. Keyring links expose relationship metadata, as do public routing envelopes.

This is one client implementation tested against two independently instantiated providers, not the draft's required interoperability check with an independently developed second client. Published cross-implementation vectors, independent cryptographic review, browser crash/quota tests on supported engines, key lifecycle completion, and operational abuse/storage limits are release gates. Automated tests do not substitute for these gates.

## Run locally

```sh
npm ci
npm run build:protocol
node scripts/mimori-protocol-local.mjs
npx wrangler dev --config wrangler.protocol.local.jsonc --port 8789
npm test
```

The setup script explicitly uses `--local` for both isolated databases. It does not import production data or create production resources. Use an invited local legacy account; the existing admin/invitation tooling can target the local configuration. Do not reuse production passwords for testing.

The production Worker returns 404 for the preview and protocol API unless the feature flag and separate database binding are supplied. The UI bundle is generated and ignored by Git; `npm run build:protocol` is required for a preview build. Protocol source, migrations and local configuration are excluded from static assets.

## Files

- `protocol/records.mjs`: strict canonical encoding, signatures, identities and AEAD.
- `protocol/vault.mjs`: password-protected vault creation/unlock/rewrap.
- `protocol/ratchet.mjs`: pinned library adapter and signed one-time prekeys.
- `protocol/local-store.mjs`: password-unlocked encrypted durable store and transactions.
- `protocol/provider.mjs`: gated provider API with injected account authentication.
- `protocol/client.mjs`: enrollment, keyring, transport, durable events/outbox, import and replay.
- `protocol/social.mjs`: event validation/projection and history replay.
- `protocol/browser.mjs`: preview UI, bundled into the preview route.
- `tests/protocol*.test.mjs`: primitives, storage conformance, social semantics, provider isolation, cross-provider exchange and coordinator forwarding.

## Validation on this branch

- Full test suite: 73 passed, 0 failed.
- Two independent provider databases exchanged encrypted posts, replies, likes, removals and history replay.
- Three identities exercised coordinator forwarding between two people who are not keyring partners.
- Encrypted archive backup/restore and legacy export isolation passed.
- The IndexedDB adapter passed all 16 SDK backend-conformance cases, including reopen. A simulated failed outer transaction committed neither ratchet state nor outbox; a successful transaction survived reopen with identical ciphertext.
- The actual browser preview passed login, explicit enrollment, encrypted-backup download, protected profile saving, posting, refresh/backup, lock/reload/unlock and retained-post checks. Responsive styling inherits the original breakpoints; a separate mobile-device runtime check is still pending.
- Production bundle dry-run passed with the new protocol flag absent and only the original production D1 binding. No deployment was performed.

## Hosted preview rollout

The user authorized deploying the experimental preview and renaming it Mimori. The canonical page is `/mimori/`, the API is `/api/mimori/v1/`, and discovery is `/.well-known/mimori`. The old preview URL redirects with query parameters preserved; old protocol API/discovery URLs remain aliases. Existing `/mimorigasaka/` posts and invitation management remain available.

A fresh prelaunch backup was restore-verified again: 4 accounts and 16 post rows. Only the separate `morisoba-mimori-protocol` database receives protocol migrations. The build generates the browser bundle automatically on deployment. Hosting this experimental preview does not remove the review and device-recovery limitations above.
