# Slice 1·2 Implementation Plan — the `protected()` crypto module

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build slice 1·2 — the pure `@magna-carta/encryption` package (envelope, key hierarchy, blind indexes) and the `protected()` enforcement chokepoint in `data-access`, with provisioning key-mint, the `firm_secret` store, the incident-description upgrade, crypto-shred, and the TOTP closure.

**Architecture:** `@magna-carta/encryption` is pure (injected `CryptoKey` handles, no D1/Hono/env); `data-access` adds the firm-key provider (control-plane wrapped key → non-extractable HKDF handle, cached per isolate) and the field chokepoint (`composeProtectedWrite` / `readProtected` / `blindIndexValue`). The Worker wires the provisioning mint step, two idempotent backfill sweeps (key-mint for existing firms, incident encryption), and `shredFirmKey`. Everything decrypt-shaped is permission-gated + audited, inseparably.

**Tech Stack:** native Web Crypto only (AES-256-GCM, AES-KW, HKDF-SHA-384, HMAC-SHA-384) — **zero new runtime dependencies**; `@magna-carta/{identifiers,database,data-access,access-control}`; Miniflare via `@cloudflare/vitest-pool-workers`.

**Spec:** [`2026-06-12-slice-1-2-protected-crypto-module-design.md`](2026-06-12-slice-1-2-protected-crypto-module-design.md) · ADR-0084 (ADR-0026/0046/0068/0073 upstream).

**Build gates (do not start before):** 0·4 landed (`FirmProvisioner`, control-plane registry, access-control), 0·6 landed (`incident` table), 1·1 backend landed (per-firm `audit_log`). Build order 1·1 → 1·2 satisfies all three.

## Decided up front (read before coding)

1. **Secrets:** `ROOT_KEK` Worker secret — 32 random bytes, base64 (generate: `openssl rand -base64 32`); local value in `.dev.vars`, test value via Miniflare bindings in `vitest.config.ts`. Recorded in the secrets inventory (Task 12).
2. **Zero new runtime dependencies.** Everything is `crypto.subtle` + `crypto.getRandomValues`. Unit tests run in plain Vitest on Node's webcrypto (Node 22 supports AES-KW/HKDF/HMAC-SHA-384 — verify at build); a **Workers-runtime parity test** (Task 11) re-runs the core vectors under Miniflare so a runtime divergence fails loud.
3. **Envelope constants** (`packages/encryption/src/envelope.ts`): `ALGO_VERSION_AES256GCM_V1 = 1`; frame = `Uint8Array` `[algo(1) | key_version(1) | iv(12) | ct+tag]`; stored as standard base64 TEXT. `key_version` 1–255 (a byte); refusals are named errors `envelope-unknown-version` / `envelope-malformed`.
4. **HKDF constants** (frozen): salt = UTF-8 `magna-carta-protected-v1`; info `mc:v1:pii` / `mc:v1:secrets` / index subkeys `mc:v1:index:<table>:<field>:<index_name>`. Never edit these strings — a change is a new version, not an edit.
5. **AAD** = UTF-8 of `mc:aad:v1|<firm_id>|<table>|<field>|<row_primary_key>|<algo_version>|<key_version>` — one serializer function, golden vectors committed (Task 2).
6. **Key-handle cache:** module-level `Map<string, CryptoKey>` in the data-access firm-key provider, cap 32, insertion-order eviction (a plain Map suffices; no LRU dependency). Safe because handles are non-extractable. A shred **must** also delete the cache entry (test covers the same-isolate window).
7. **Identifier prefix addition:** `firmSecret→fse` (follow the registry's existing shape; extend its enumeration tests). No other new prefixes — protected values live in existing rows.
8. **`readProtected` context:** takes the caller's already-resolved `effectivePermissions: ReadonlySet<Permission>` (the 0·4/0·5 chokepoint supplies it) — data-access does not re-query roles per decrypt. The audit insert composes into the same `batch()` as… nothing else: a decrypt is a _read_; the audit row is written via a small immediate `composeEffectBatch`-style single-statement batch (the one write a read performs). Decrypt result is returned only after the audit write succeeds (fail-closed ordering).
9. **Permission registry additions:** `firm:manageSecrets`, `incidents:viewDescription`. Role-seed grants: Owner/Admin both; others none (adjustable data). New per-firm migration appends the grants (the 0·4 seed pattern).
10. **Backfill sweeps** (Task 10): one generic `runFirmBackfill(name, env, firmRow, step)` helper in `apps/worker/src/scheduled.ts` — idempotent per firm (each sweep's step no-ops when nothing qualifies), wired into the existing cron. Two registrations: `protected-key-mint` (control-plane: mint for `wrapped_firm_key IS NULL` active firms without a shred audit) and `incident-description-encrypt` (per-firm: encrypt rows where `description_ciphertext IS NULL AND description IS NOT NULL`).
11. **Better Auth `encryptionKeys`:** verify the exact option name/shape against the pinned version's docs at build; configure rotation array with the current auth secret; harden the 0·4 stored-value test to also assert the value round-trips through Better Auth's own decrypt path. If the pinned version lacks the array, record an ADR-0084 amendment and keep the singular secret (the verification test is the load-bearing artifact either way).
12. **Incident plaintext contract step is deferred:** this slice adds `description_ciphertext`, switches writes, and backfills; the migration **dropping** `description` ships in a later slice after a verification window (expand-contract discipline — note it in the migration's `-- contract:` plan comment).
13. **Concurrent-session discipline:** stage explicit paths; every commit gated `pnpm check && vp test` for touched packages.

## File structure

```
packages/encryption/
  package.json · tsconfig.json · vitest.config.ts        # mirror packages/identifiers configs
  src/aad.ts               # serializeAad — the single canonical serializer
  src/envelope.ts          # encodeEnvelope / decodeEnvelope + named refusals
  src/keys.ts              # importRootKek, generateFirmKeyBytes, wrapFirmKey, unwrapFirmKeyToHkdfKey,
                           #   deriveAesGcmPurposeKey, deriveIndexSubkey
  src/normalize.ts         # normalizeToDigits, normalizeUppercaseStrip, withStatePrefix, toNfc
  src/blind-index.ts       # computeBlindIndex (normalize → HMAC-SHA-384 → truncate → "1:" + base64)
  src/protect.ts           # encryptProtectedValue / decryptProtectedValue (envelope + AAD + GCM)
  test/aad.test.ts · envelope.test.ts · keys.test.ts · normalize.test.ts · blind-index.test.ts · protect.test.ts
  test/golden/aad-vectors.json · blind-index-vectors.json
packages/identifiers/src/prefix-registry.ts              # MODIFY: firmSecret→fse
packages/database/src/control-plane-schema.ts            # MODIFY: firm.wrapped_firm_key/firm_key_version/root_key_version
packages/database/src/per-firm-schema.ts                 # MODIFY: firm_secret; incident.description_ciphertext
packages/database/drizzle/{control-plane,per-firm}/      # generated migrations (+ role-grant seed)
packages/access-control/src/registry.ts                  # MODIFY: firm:manageSecrets, incidents:viewDescription
packages/data-access/src/firm-key-provider.ts            # wrapped key → cached non-extractable HKDF handle; shred-aware
packages/data-access/src/protected-fields.ts             # protectedField, composeProtectedWrite, readProtected, blindIndexValue
packages/data-access/src/protected-field-registry.ts     # the static declaration list (fitness anchor)
packages/data-access/src/secret-statements.ts            # putSecret / getSecret over firm_secret
apps/worker/src/firm-provisioner.ts                      # MODIFY: key-mint step
apps/worker/src/firm-key-shred.ts                        # shredFirmKey (function only, no route)
apps/worker/src/scheduled.ts                             # MODIFY: runFirmBackfill + the two sweeps
apps/worker/src/auth.ts                                  # MODIFY: encryptionKeys config
apps/worker/test/…                                       # per task below
```

---

### Task 1: Scaffold — package, prefix, secrets plumbing

- [ ] Scaffold `packages/encryption` mirroring `packages/identifiers` configs (package.json exports map for `./aad ./envelope ./keys ./normalize ./blind-index ./protect`, tsconfig, vitest.config). Deps: `@magna-carta/identifiers: workspace:*` (types only). No catalog additions.
- [ ] `packages/identifiers/src/prefix-registry.ts`: add `firmSecret: "fse"`; extend enumeration tests.
- [ ] `apps/worker`: add `ROOT_KEK` to `.dev.vars.example` (committed) + Miniflare test bindings in `vitest.config.ts` (any fixed base64 32-byte value for tests).
- [ ] `vp install`; `vp test` (identifiers green); commit `chore(encryption): scaffold package + fse prefix + ROOT_KEK plumbing`.

### Task 2: AAD serializer (`src/aad.ts`) + golden vectors

TDD.

```ts
export interface AadContext {
  readonly firmId: string;
  readonly table: string;
  readonly field: string;
  readonly rowPrimaryKey: string;
  readonly algoVersion: number;
  readonly keyVersion: number;
}
// The single canonical AAD serializer (ADR-0084 §4). Byte-identical write/read is the contract;
// the committed golden vectors pin it — any change to this function is a new aad version, never an edit.
export function serializeAad(context: AadContext): Uint8Array; // UTF-8 of mc:aad:v1|...|...
```

- [ ] Tests: exact string for a known context (compare to `test/golden/aad-vectors.json` — 4 committed vectors covering different handles/versions); determinism; distinct contexts → distinct bytes (each component varied).
- [ ] Commit `feat(encryption): canonical AAD serializer + committed golden vectors`.

### Task 3: Envelope (`src/envelope.ts`)

TDD.

```ts
export const ALGO_VERSION_AES256GCM_V1 = 1;
export interface EnvelopeParts {
  readonly algoVersion: number;
  readonly keyVersion: number;
  readonly iv: Uint8Array; // 12 bytes
  readonly ciphertext: Uint8Array; // GCM ct + 16-byte tag
}
export function encodeEnvelope(parts: EnvelopeParts): string; // base64 of the binary frame
export function decodeEnvelope(stored: string): EnvelopeParts; // throws EnvelopeError("envelope-malformed" | "envelope-unknown-version")
```

- [ ] Tests: round-trip; decode rejects: not-base64, frame < 31 bytes (`1+1+12+16+1` minimum), unknown algo version (=2), iv length preserved exactly; key_version 255 round-trips; encode rejects iv ≠ 12 bytes.
- [ ] Commit `feat(encryption): versioned ciphertext envelope encode/decode`.

### Task 4: Key hierarchy (`src/keys.ts`)

TDD (Node webcrypto; parity re-run in Task 11).

```ts
export function importRootKek(base64Kek: string): Promise<CryptoKey>; // AES-KW, non-extractable, ["wrapKey","unwrapKey"]
export function generateFirmKeyBytes(): Uint8Array; // 32 bytes, getRandomValues — provisioning-mint only
export function wrapFirmKey(rootKek: CryptoKey, firmKeyBytes: Uint8Array): Promise<string>; // AES-KW → base64
export function unwrapFirmKeyToHkdfKey(
  rootKek: CryptoKey,
  wrappedBase64: string,
): Promise<CryptoKey>; // non-extractable HKDF, ["deriveKey"]
export type Purpose = "pii" | "secrets";
export function deriveAesGcmPurposeKey(
  firmHkdfKey: CryptoKey,
  purpose: Purpose,
): Promise<CryptoKey>; // AES-GCM-256, non-extractable
export function deriveIndexSubkey(
  firmHkdfKey: CryptoKey,
  table: string,
  field: string,
  indexName: string,
): Promise<CryptoKey>; // HMAC-SHA-384, non-extractable, ["sign"]
```

HKDF parameters per decided #4 (salt constant, info strings; hash SHA-384).

- [ ] Tests: every returned key has `extractable === false` and exactly the expected `usages`; wrap→unwrap→derive→encrypt→decrypt round-trip works; **wrong root KEK fails unwrap**; same firm key + same purpose → keys that decrypt each other's output; `pii` key cannot decrypt `secrets` output (derive both, encrypt under one, decrypt under other → throws); index subkeys for different `(table, field, indexName)` produce different HMACs over the same input.
- [ ] Commit `feat(encryption): non-extractable key hierarchy — wrap/unwrap + HKDF-SHA-384 purpose keys`.

### Task 5: Normalization transforms (`src/normalize.ts`)

TDD — these are frozen contracts (ADR-0084 §5); the vectors are their specification.

```ts
export function toNfc(value: string): string; // Unicode NFC — applied first by every transform
export function normalizeToDigits(value: string): string; // "123-45-6789" -> "123456789"; throws on no digits
export function normalizeUppercaseStrip(value: string): string; // uppercase, strip spaces/dashes/dots
export function withStatePrefix(state: string, value: string): string; // "NV:" + normalizeUppercaseStrip — DL transform
```

- [ ] Tests (vector-style, committed in `test/golden/blind-index-vectors.json` alongside Task 6's): SSN formatted ≡ unformatted; account "12 34-56" → "123456"; DL lowercase+spaces → state-prefixed canonical; NFC: `é` composed ≡ decomposed; empty/garbage inputs throw named errors.
- [ ] Commit `feat(encryption): frozen normalization transforms with vector specifications`.

### Task 6: Blind index (`src/blind-index.ts`)

TDD.

```ts
export interface BlindIndexSpec {
  readonly table: string;
  readonly field: string;
  readonly indexName: string; // versioned: changing L or transform = new name
  readonly normalize: (value: string) => string;
  readonly lengthBits: 16 | 24 | 32;
}
// "1:" + base64(truncate(HMAC-SHA-384(normalize(plaintext)), lengthBits)) — ADR-0084 §5
export function computeBlindIndex(
  subkey: CryptoKey,
  spec: BlindIndexSpec,
  plaintext: string,
): Promise<string>;
```

- [ ] Tests: golden vectors (fixed test subkey material → exact expected strings, committed); formatted and unformatted SSN produce identical values; truncation exact (16 bits → 2 bytes before base64); version prefix `1:` present; different `indexName` → different value for same plaintext (via differing subkeys from Task 4).
- [ ] Commit `feat(encryption): blind-index computation — version-prefixed truncated HMAC`.

### Task 7: Protect/unprotect (`src/protect.ts`)

TDD.

```ts
export function encryptProtectedValue(
  purposeKey: CryptoKey,
  aad: AadContext,
  plaintext: string,
): Promise<string>; // fresh IV, encode envelope
export function decryptProtectedValue(
  purposeKey: CryptoKey,
  aad: AadContext,
  stored: string,
): Promise<string>; // decode, AAD check via GCM
```

The **only** IV source in the package is inside `encryptProtectedValue` (`crypto.getRandomValues(new Uint8Array(12))`).

- [ ] Tests: round-trip; **AAD mismatch matrix** — vary each `AadContext` component individually (firmId, table, field, rowPrimaryKey, algoVersion, keyVersion) → decrypt throws; same plaintext encrypted twice → different stored values and different IVs; 1,000 encryptions → 1,000 distinct IVs (the random-IV fitness assertion); tampered ciphertext byte → throws; `decodeEnvelope` refusals surface unchanged.
- [ ] Commit `feat(encryption): AAD-bound encrypt/decrypt over the versioned envelope`.

### Task 8: Schema + permissions (`packages/database`, `packages/access-control`)

- [ ] Control-plane schema: `firm` gains `wrapped_firm_key` TEXT (nullable), `firm_key_version` INTEGER notNull default 1, `root_key_version` INTEGER notNull default 1. Generate migration; expand-contract guard passes (additive).
- [ ] Per-firm schema: `firm_secret` (`id` TEXT `fse_` PK, `name` TEXT notNull UNIQUE, `ciphertext` TEXT notNull, `created_at`/`updated_at`); `incident` gains `description_ciphertext` TEXT nullable (with the decided #12 `-- contract:` plan comment in the migration). Generate migration; append role-grant seed SQL (decided #9).
- [ ] `packages/access-control/src/registry.ts`: add `firm:manageSecrets`, `incidents:viewDescription` (+ registry tests).
- [ ] Schema fitness additions: `firm_secret.ciphertext` and `incident.description_ciphertext` registered as protected columns (a small exported list in the database package the Task 9 conformance test consumes).
- [ ] `vp test` green; commit `feat(database,access-control): protected-module schema — wrapped firm keys, firm_secret, incident ciphertext, permissions`.

### Task 9: Data-access chokepoint

TDD against stub-d1 + real SQLite + Miniflare (existing patterns).

- [ ] `src/firm-key-provider.ts`:

```ts
export interface FirmKeyProvider {
  getFirmHkdfKey(firmId: FirmId): Promise<CryptoKey>; // throws FirmKeyUnavailableError on null wrapped key (shredded/unminted)
  invalidate(firmId: FirmId): void; // shred path calls this
}
export function createFirmKeyProvider(options: {
  rootKekBase64: string;
  readWrappedKey: (
    firmId: FirmId,
  ) => Promise<{ wrappedFirmKey: string | null; firmKeyVersion: number } | null>;
  cacheCapacity?: number; // default 32
}): FirmKeyProvider;
```

Tests: caches (readWrappedKey called once for two gets); capacity eviction; null wrapped key → `FirmKeyUnavailableError` (fail closed, not cached); `invalidate` forces re-read.

- [ ] `src/protected-fields.ts` — the API from spec §6 (`protectedField`, `composeProtectedWrite`, `readProtected`, `blindIndexValue`), `readProtected` per decided #8: permission absent → throw the 403-mapped named error with **no decrypt attempted and no audit row**; permission present → audit insert (the 1·1 `insertAuditLogStatement`, event `protected.decrypt`, metadata `{table, field}` — never the value) **committed before** the plaintext is returned.
- [ ] `src/protected-field-registry.ts`: this slice's declarations — `incidentDescription` (purpose `pii`, permission `incidents:viewDescription`, no blind index) — plus the registry array. Conformance fitness test: every declaration's permission ∈ access-control registry; every protected column (database package's list) has exactly one declaration; every declaration's column exists in the schema.
- [ ] `src/secret-statements.ts`: `putSecret(context, name, value)` (upsert, idempotent-effect composed) / `getSecret(context, name)` (permission `firm:manageSecrets`, audited like any protected read; null on absent name).
- [ ] Integration: full write→read round-trip on real SQLite; 403 path (no audit row); audited decrypt; blind-index match without decrypt audit (use a synthetic SSN-like declaration in tests); shred-invalidated provider → every read fails closed while a second firm still reads; secrets round-trip.
- [ ] Commit `feat(data-access): protected() chokepoint — firm-key provider, audited decrypt, blind-index values, secrets store`.

### Task 10: Worker wiring — mint, sweeps, shred, TOTP closure

- [ ] `firm-provisioner.ts`: new idempotent step after bucket creation — `generateFirmKeyBytes` → `wrapFirmKey` → store (guard: `wrapped_firm_key IS NULL`); re-run mints nothing (provisioner resume tests extend).
- [ ] `scheduled.ts`: `runFirmBackfill` helper (decided #10) + the two sweeps — `protected-key-mint` (control-plane scan) and `incident-description-encrypt` (per-firm: select unencrypted, `composeProtectedWrite` each, batch; plaintext column left in place per decided #12, writes from 0·6's incident intake switch to ciphertext-only in this task).
- [ ] `firm-key-shred.ts`: `shredFirmKey(env, firmId)` — null the wrapped key + `firm.key_shredded` row in `auth_audit` + `firmKeyProvider.invalidate(firmId)`. Function only; no route.
- [ ] `auth.ts`: Better Auth `encryptionKeys` rotation array (decided #11 — verify exact option against pinned docs); harden the TOTP stored-value test (not raw seed + round-trips through the library's decrypt).
- [ ] Integration (Miniflare): provision → firm has wrapped key; sweep on a keyless firm mints exactly once; incident created pre-slice (seeded plaintext row) → sweep encrypts it once, re-run no-ops; new incident writes ciphertext only; `readProtected` on it needs `incidents:viewDescription` and audits; shred → incident description unreadable, second firm unaffected.
- [ ] Commit `feat(worker): firm-key mint + backfill sweeps + crypto-shred + TOTP encryption closure`.

### Task 11: Parity, end-to-end, source scan

- [ ] **Workers-runtime parity test** (`apps/worker/test/encryption-parity.test.ts`, workers pool): re-run the Task 2/6/7 golden vectors and an AAD-mismatch case under Miniflare — Node-vs-workerd divergence fails loud.
- [ ] **No-plaintext-escape source scan** (the 0·3 source-scan pattern, repo-wide fitness test): no file outside `packages/data-access` selects a registered protected column by name in SQL; within data-access, only `protected-fields.ts`/`secret-statements.ts` reference them; no `console.*`/telemetry/outbox call site receives the result of `readProtected` (scan for identifier flow is over-broad — assert instead: protected column names appear only in the two sanctioned modules + schema + migrations).
- [ ] `apps/worker/test/slice-1-2-e2e.test.ts`: provision two firms → put a secret in firm A → read back (audited) → member without `firm:manageSecrets` gets 403 + no audit → incident with sensitive description → decrypt audited → blind-index synthetic field matches across formatted/unformatted writes → shred firm A → its secret and incident unreadable, firm B intact.
- [ ] Full `vp test` + `pnpm check` green; commit `test(worker): slice 1·2 parity, end-to-end, and no-plaintext-escape scan`.

### Task 12: Docs + closeout (golden rule 5 — same PR)

- [ ] `packages/encryption/CLAUDE.md` (area template): frozen-constants rule (info strings, AAD format, transforms — change = new version, never an edit), the non-extractable-keys invariant, the single-IV-source rule.
- [ ] [`docs/conventions/invariants.md`](../conventions/invariants.md): protected-field invariants (decrypt = permission + audit, inseparable; no plaintext path outside the chokepoint; envelope/AAD versioning discipline; normalization transforms frozen).
- [ ] [`docs/conventions/security.md`](../conventions/security.md): managed-secrets inventory gains `ROOT_KEK` and records the Better Auth auth-secret rotation array; crypto-shred operational note (same-isolate cache window, the `invalidate` requirement).
- [ ] `ROADMAP.md` / `CHANGELOG.md` / `STATUS.md` (Built `[x]` after the in-build 7-angle adversarial review completes).
- [ ] Decision Log: ADR-0084 amendments only if build-time verification deviated (decided #2 Node webcrypto, #11 encryptionKeys shape).
- [ ] No user docs (no UI). `pnpm check`; commit `docs: slice 1·2 closeout`.

## Self-review (spec coverage)

§1 placement → Tasks 1, 9 · §2 hierarchy → Task 4 (mint: Task 10; cache: Task 9; shred: Tasks 9/10) · §3 envelope → Task 3 · §4 AAD → Tasks 2, 7 · §5 blind indexes → Tasks 5, 6 (policy table consumed by 1·3's declarations; synthetic-field tests here) · §6 chokepoint → Task 9 · §7 TOTP → Task 10 · §8 schema + consumers → Tasks 8, 9 (secrets), 10 (incident, sweeps) · §9 testing/fitness → distributed + Task 11 (parity, scan, e2e); fixtures gain the wrapped demo-firm key in Task 10's integration seeds · §10 out-of-scope honored (no rotation machinery, no compound indexes, no Directory fields, no offboarding route).
