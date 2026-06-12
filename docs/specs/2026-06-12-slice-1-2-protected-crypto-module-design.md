# Slice 1·2 — the `protected()` crypto module — design

**Status:** Accepted (design) · **Date:** 2026-06-12 · **Owner:** Trevor Goldsmith
**White-paper home:** _Encryption and key management_
**Research input:** [`docs/research/protected-crypto-module.md`](../research/protected-crypto-module.md)
**ADRs:** ADR-0026 (encryption & keys — architecture; **TOTP line closed by this cycle**) · ADR-0046 (post-quantum posture) · ADR-0068 (access-control model) · **ADR-0084 (envelope, context binding & blind-index policy — this slice's new decision)**

This spec is the implementation-grade design for slice 1·2 ([`ROADMAP.md`](../../ROADMAP.md)): the field-level encryption module ADR-0026 architected — envelope encryption, HKDF purpose keys, the `protected()` field type in the data-access layer, and the HMAC blind index that gives Conflicts an exact-match channel over encrypted identifiers. It does not restate ADR-0026 (key model, narrow protected set, chokepoint enforcement, crypto-shred) — it fixes the bytes, parameters, APIs, and policies below those decisions, resolving the research doc's section G items. Backend only; no UI.

**Build gates:** slice 0·4 landed (`FirmProvisioner`, control-plane firm registry, `@magna-carta/access-control`), slice 0·6 landed (the `incident` table this slice upgrades), and slice 1·1's backend landed (the per-firm `audit_log` table decrypt audits write to). The planned build order 1·1 → 1·2 satisfies all three. Prerequisite for slice 1·3 (Directory declares its sensitive-identifier fields against this machinery).

---

## 1. Module placement

Two layers on the ADR-0071 structure-vs-access seam:

- **`@magna-carta/encryption`** — new pure package: envelope encode/decode, AES-KW wrap/unwrap, HKDF purpose-key derivation, blind-index computation, the AAD canonical serializer. All key material arrives as injected `CryptoKey` handles; no D1, no Hono, no `env`. Dependencies: `@magna-carta/identifiers` types only.
- **`packages/data-access`** — extended with the enforcement chokepoint: the `protected()` field declaration, `composeProtectedWrite`, `readProtected` (role-gated + audited), `blindIndexValue`, and the `getSecret`/`putSecret` per-firm credential store. Protected fields ride the same firm-scoped gate as every other read (golden rule 3). Dependency direction: `data-access → encryption`.

A separate crypto Worker/service stays rejected (ADR-0026 — an online decrypt path hands the caller plaintext regardless; a hop adds latency and a deployable for illusory isolation).

## 2. Key hierarchy (ADR-0026, realized)

```
ROOT_KEK (Worker secret, 256-bit) ──AES-KW──▶ per-firm key (wrapped, control-plane firm row)
                                                   │ HKDF-SHA-384, versioned info strings
                                     ┌─────────────┼──────────────┐
                                  pii key       secrets key    index root key
                                 (AES-GCM-256) (AES-GCM-256)  (HMAC-SHA-384 → per-field subkeys)
```

- **Provisioning mints the firm key:** the 0·4 `FirmProvisioner` gains an idempotent step (guard: `wrapped_firm_key IS NULL` and no shred audit) — generate 32 bytes via `crypto.getRandomValues`, AES-KW-wrap under the root KEK, store. A one-off **key-mint sweep** covers firms provisioned before this slice (same backfill pattern as the incident sweep, §8).
- **Non-extractable keys end to end:** the wrapped firm key is unwrapped **directly into a non-extractable HKDF `CryptoKey`** (`unwrapKey(… , { name: "HKDF" }, false, ["deriveKey"])`); purpose keys derive via `deriveKey` (never `deriveBits`), also non-extractable — AES-GCM keys with `["encrypt","decrypt"]`, the index root and per-field subkeys as HMAC keys with `["sign"]`. Raw key bytes exist in the JS heap only at provisioning-mint time; afterwards a heap dump or logging mistake can leak only unusable handles.
- **Per-isolate key-handle cache:** `Map<firmId, CryptoKey>` for the unwrapped HKDF base key, bounded (LRU, small cap), safe to cache precisely because handles are non-extractable. Purpose keys re-derive on demand (cheap).
- **Hashes:** HKDF and HMAC use **SHA-384** (ADR-0046's CNSA-2.0 margin, free here). Payloads AES-256-GCM. The wrap is AES-KW (RFC 3394, deterministic, no IV — correct for key wrap; never substitute AES-GCM there).
- **Domain separation (HKDF `info` constants, frozen):** `mc:v1:pii`, `mc:v1:secrets`; per-field index subkeys `mc:v1:index:<table>:<field>:<index_name>` (CipherSweet's per-index-subkey refinement: indexes over different fields can never be cross-correlated, and a future per-field reindex is scoped). HKDF salt: the fixed public constant `magna-carta-protected-v1`.
- **Crypto-shred:** `shredFirmKey(firmId)` nulls `wrapped_firm_key` in the control-plane registry and writes the shred audit (`firm.key_shredded` in the control-plane `auth_audit` table — the registry's existing audit home from 0·4) — the firm's entire protected corpus is then permanently unreadable (decrypts fail closed). Function + tests ship in this slice; the offboarding flow that invokes it is a named seam for the offboarding design. Platform-admin guarded (the 0·4 secret-header model) if exposed at all this slice — default is function-only, no route.

## 3. Ciphertext envelope (ADR-0084)

Binary frame, base64-encoded into a TEXT column:

```
[ algo_version: 1 byte | key_version: 1 byte | iv: 12 bytes | AES-GCM ciphertext + 16-byte tag ]
```

- **`algo_version = 1`** ≡ AES-256-GCM payload, HKDF-SHA-384 derivation, AAD format v1. Any future cipher/wrap change (e.g. the ADR-0046 hybrid ML-KEM wrap) is a new version byte + dual-read rotation — never a schema change.
- **`key_version`** = the firm-key generation that encrypted this value; what makes per-firm rotation a dual-read migration instead of a flag day. Reserved now (one byte) even though rotation machinery is deferred.
- **IV:** fresh 96-bit value from `crypto.getRandomValues` per encryption, stored in the frame. We are on AES-GCM by ADR-0026's FIPS-friendly primitive set (not a wide-nonce cipher), so IV-uniqueness is enforced in code — the write path has exactly one IV source and a fitness test (§9).
- **Decode validates before decrypting:** frame length and a known `algo_version`; unknown/short → named refusal (`envelope-unknown-version`, `envelope-malformed`), never a garbage decrypt attempt.

## 4. Context binding — AAD (ADR-0084)

Every `encrypt`/`decrypt` passes AAD, the canonical UTF-8 string:

```
mc:aad:v1|<firm_id>|<table>|<field>|<row_primary_key>|<algo_version>|<key_version>
```

A ciphertext moved to another row, field, table, or firm fails GCM authentication on decrypt — closing the ciphertext-shuffle correlation hole that platform at-rest encryption does not address (CipherSweet threat model: "use primary keys as authenticated data"). Components are pipe-free by construction (identifier handles and fixed schema names); one serializer function in `@magna-carta/encryption` is the single source for write and read, pinned by committed golden vectors (§9). `firm_id` is supplied by the data-access firm context, never by the caller.

## 5. Blind indexes (ADR-0084)

`blind_index = "1:" + base64( truncate( HMAC-SHA-384( normalize(plaintext), perFieldSubkey ), L_bits ) )` — the `1:` prefix is the `index_key_version`, carried in the value (one column, dual-read-able on a future reindex). Stored in a sibling indexed column (`<field>_blind_index`); matched with plain `WHERE` equality; **matching never decrypts and requires no decrypt permission**.

**Per-field policy table (the binding contract; Directory declares against it in 1·3):**

| Field                       | Encrypt (purpose) | Blind index | Normalization (frozen contract)                                  | `L_bits` |
| --------------------------- | ----------------- | ----------- | ---------------------------------------------------------------- | -------- |
| SSN                         | `pii`             | standalone  | strip to digits (`123-45-6789` ≡ `123456789`)                    | 16       |
| Financial / account numbers | `pii`             | standalone  | strip spaces/dashes, uppercase                                   | 24       |
| Driver's license            | `pii`             | standalone  | uppercase, strip formatting, **prefix issuing state** (`NV:...`) | 16       |
| DOB                         | `pii`             | **none**    | —                                                                | —        |
| SSN last-four               | (within SSN)      | **none**    | —                                                                | —        |
| Plugin credentials          | `secrets`         | none        | —                                                                | —        |
| Incident descriptions       | `pii`             | none        | —                                                                | —        |

- **Low-entropy ruling:** DOB (~15 bits) and last-four (~13 bits) are never standalone-indexed — frequency analysis converges on them regardless of tuning. Conflicts matches DOB by **decrypt-and-compare on the candidate set** a higher-entropy match already produced (decrypt inside the conflicts engine is a permitted, audited operation). A compound index (e.g. DOB+surname) is a named seam, built only if measurement demands it.
- **`L_bits` rationale (recorded, per-field tunable):** coincidence `C = R / 2^min(L, K)`, target `2 ≤ C < √R`. At the design ceiling R ≈ 100,000 directory rows per firm: SSN (K ≈ 30) at L = 16 → C ≈ 1.5 (each index value plausibly maps to >1 person; false positives trivially filtered by the engine's follow-up); account numbers are high-K so L = 24 keeps C in range at larger R. Changing a field's `L` or transform is a **versioned reindex** (new `index_name` → new subkey + new version prefix), never silent.
- **Normalization transforms are frozen contracts.** Changing one breaks matching against every stored index (full decrypt-reindex, needs plaintext). They live in `@magna-carta/encryption` with exhaustive unit vectors as their specification: digit-stripping, uppercase+strip, state-prefixing, NFC unicode normalization applied before every transform.
- **What a blind index leaks (accepted knowingly, documented):** equality and frequency distribution under DB-only access — never plaintext, order, or substrings. Mitigations carried: minimal index count per field, no low-entropy standalone indexes, AAD row binding (§4).
- **Exact-match only (the Conflicts partition):** blind indexes are the **exact-identifier channel**; fuzzy/phonetic name matching runs on plaintext name columns, which ADR-0026 deliberately leaves unencrypted. Carried as input to the slice 1·3 Directory/Conflicts design (already reflected in [`docs/research/conflicts-matching-engine.md`](../research/conflicts-matching-engine.md)).

## 6. The `protected()` chokepoint (data-access)

```ts
const ssn = protectedField({
  table: "entity_identifier",
  field: "ssn",
  purpose: "pii", // pii | secrets
  permission: "directory:viewSensitiveIdentifiers", // ADR-0068 registry key required to decrypt
  blindIndex: { name: "exact", normalize: normalizeToDigits, lengthBits: 16 }, // optional
});
```

- **Write:** `composeProtectedWrite(context, fieldDeclaration, rowPrimaryKey, plaintext)` → `{ ciphertextValue, blindIndexValue? }`, composed into the row's atomic effect batch (slice 0·2 chokepoint). Encryption is a property of the field type, never a step to remember.
- **Read:** `readProtected(context, fieldDeclaration, row)` — (1) permission check through the access-control resolver (fail → the standard 403 problem, **no** decrypt attempted), (2) **audit row** in the per-firm `audit_log` (`protected.decrypt`, actor, subject row, table+field — never the value), (3) decrypt with full AAD. The audit write and the read are not separable.
- **Match:** `blindIndexValue(fieldDeclaration, plaintext)` for equality lookups; no permission, no audit (nothing is revealed beyond what the caller already supplied).
- **Secrets store:** `putSecret(context, name, value)` / `getSecret(context, name)` over the `firm_secret` table — purpose `secrets`, permission `firm:manageSecrets` (new registry key, `firm` namespace from 0·4); `getSecret` is audited like any protected read. The core Worker decrypts and hands plaintext to plugin Workers; plugin Workers never see key material (white paper).
- **Registry/declaration discipline:** field declarations are static module-level constants; a fitness test asserts every declaration's `permission` exists in the access-control registry and every protected column in the schema has exactly one declaration.

## 7. TOTP seeds — ADR-0026's open line, closed (owner decision, 2026-06-12)

**Accept Better Auth's at-rest encryption** (option 1 of the research's three): seeds are auth credentials owned by a _user_, read at login before firm context exists — outside the firm-keyed chokepoint by structure, not oversight. This slice: (1) configure the Better Auth `encryptionKeys` rotation array (first key encrypts, rest decrypt); (2) harden the 0·4 stored-value-is-not-the-raw-seed verification test against the pinned version; (3) record the auth secret in the managed-secrets inventory ([`docs/conventions/security.md`](../conventions/security.md)) alongside the root KEK; (4) amend ADR-0026's TOTP line to this decision. The Better-Auth-hook path (option 2, a control-plane purpose key) was rejected for permanent coupling to library internals with no security gain against the actual threat (database exfiltration — both options defeat it; running-Worker compromise — neither does, the recorded honest limit). The hook seam does not expire; revisit only if a future Better Auth version fails the verification test.

## 8. Schema changes & first consumers

**Control-plane (`firm` row, additive):** `wrapped_firm_key` TEXT nullable (base64), `firm_key_version` INTEGER notNull default 1, `root_key_version` INTEGER notNull default 1. Null = not-yet-minted or shredded (distinguished by the shred audit event).

**Per-firm:** `firm_secret` (`id` handle PK, `name` UNIQUE, `ciphertext`, timestamps). `incident.description` upgrades to protected by **expand-contract**: add `description_ciphertext` → code writes encrypted only → a **one-off backfill sweep** (worker cron task, runs once per firm, idempotent: encrypts rows where ciphertext is null and plaintext is present) → a later contract migration drops the plaintext column. Migrations are SQL-only and cannot encrypt — the sweep is code by necessity; the same sweep pattern runs the §2 key-mint for pre-existing firms.

**Consumers shipping in this slice** (so the module lands exercised): the secrets store (tests + fixtures; Phase 7 integrations are the real consumer), the incident-description upgrade (0·6 seam retired), and the TOTP closure (§7 — configuration + verification, no module wiring). Directory's identifier fields are declared in 1·3 against §5's policy table.

**Permission registry additions** (ADR-0068): `firm:manageSecrets` (write + audited read of `firm_secret`) and `incidents:viewDescription` (decrypt an incident description). Directory's `directory:viewSensitiveIdentifiers` is registered by 1·3 with its fields.

## 9. Testing & fitness functions

- **Unit (`@magna-carta/encryption`):** round-trips per purpose; envelope decode refusals (unknown version, short frame); **AAD mismatch fails decrypt** — each component (row, field, table, firm, algo_version, key_version) varied individually; AES-KW wrap/unwrap; derivation determinism; blind-index vectors per transform (formatted ≡ unformatted SSN; state-prefixed DL; NFC unicode cases; exact truncation length); per-field subkeys differ for same plaintext.
- **Integration (data-access; real SQLite + Miniflare):** full chokepoint write→read round-trip; decrypt without permission → 403 and **no** `protected.decrypt` audit row; with permission → plaintext + audit row; blind-index match finds the row with zero decrypt audits; `putSecret`/`getSecret` round-trip + audit; **crypto-shred → every protected read of that firm fails closed** while other firms are unaffected; provisioning key-mint idempotent (re-run mints nothing); incident backfill encrypts each row exactly once.
- **Fitness functions:** random-IV-on-write (no repeats across N encryptions; same plaintext twice → different frames); **no-plaintext-escape source scan** — no code reads a registered protected column except through `readProtected` (the 0·3 source-scan pattern, repo-wide); AAD serialization pinned by committed golden vectors; declaration↔registry↔schema conformance (§6); the TOTP stored-value test (§7).
- **Fixtures:** the demo firm gains a wrapped key (seeded random source → deterministic), a sample secret, and an encrypted incident — exercising the module in every downstream test run.
- No UI in this slice, so no owner manual verification checklist (the convention binds UI slices); the 1·3 Directory UI checklist will include "verify an SSN displays masked and decrypt is audited."

## 10. Out of scope

Rotation machinery (root rewrap, per-firm re-encrypt, blind-index reindex — seams reserved in §3/§5, costs documented in the research §E); compound blind indexes (named seam); Directory field declarations and their UI (1·3); the offboarding flow around `shredFirmKey`; the external-KMS-rooted KEK (backlog hardening, ADR-0026 honest limits); R2 object encryption (recorded ADR-0078 constraint: any future per-firm R2 envelope layer sits below delta/dedup — unchanged here); any change to TOTP storage beyond §7.
