# `protected()` Crypto Module — Implementation Research

**Date:** 2026-06-11
**Scope:** Slice 1·2 — the `protected()` field-level encryption module (envelope encryption, HKDF purpose keys, HMAC blind index) and the open TOTP-seed-handling question. Input to the slice 1·2 **design** cycle, not a design itself; the design and build stay with the foundational/financial track per the model-split policy.
**Purpose:** Verify the ADR-0026 architecture is buildable on the current Workers runtime (golden rule 11), and fill the implementation-level gaps the design cycle will hit — the blind-index construction for Conflicts matching, the ciphertext-envelope framing, rotation mechanics, and the Better Auth TOTP decision.

## Relationship to ADR-0026 — what is already settled

ADR-0026 (white paper, _Encryption and key management_) decides the architecture, and this research does **not** revisit it:

- Envelope encryption, two stored keys: a 256-bit **root KEK** (Worker secret) wraps a **per-firm key** (stored wrapped in the control-plane firm registry); the firm key **HKDF-derives** purpose keys (`pii`, `secrets`, `index`) on demand — no data-encryption keys are ever stored.
- Primitives: **AES-KW** (wrap), **AES-GCM** (payloads), **HKDF** (derive), **HMAC** (blind index) — native Workers Web Crypto.
- Enforcement is a declarative **`protected()` field type in the firm-scoped data-access layer**: encrypt-on-write, role-gated + audited decrypt-on-read, and it maintains an HMAC **blind index** so Conflicts can match encrypted identifiers without decrypting.
- Encrypt only the narrow set: sensitive identifiers (SSN, DOB, driver's license, financial IDs), per-firm plugin credentials, TOTP seeds.
- Per-firm **crypto-shred** by destroying the wrapped firm key; **algorithm-versioning** on every ciphertext/wrapped-key/signature for PQC agility; rotation machinery deferred, seam built now.

What follows is the layer **below** those decisions: exact APIs, framing bytes, and the parameter choices that are cheap to get right up front and expensive to retrofit.

## Method & sources

Primary sources fetched and cross-checked: the Cloudflare Workers Web Crypto runtime docs; the CipherSweet documentation (Paragon Initiative) — its security/threat-model page, blind-index internals, key-hierarchy page, and the canonical 2019 design blog post — as the best-documented prior art for HMAC blind indexing over an encrypted corpus; and the Better Auth 2FA plugin docs. Full URLs in [Sources](#sources). Confidence is high on the Workers primitive support and the blind-index design math; medium on Better Auth's exact current key-rotation behaviour (docs are thin on internals — flagged where it matters).

---

## A. Workers Web Crypto — primitives confirmed (golden rule 11)

All four primitive families ADR-0026 depends on are supported by `crypto.subtle` in the Workers runtime, with the operations we need:

| Primitive           | Operations confirmed                | Use in `protected()`                                                       |
| ------------------- | ----------------------------------- | -------------------------------------------------------------------------- |
| **AES-GCM**         | `generateKey`, `encrypt`, `decrypt` | payload encryption (the `pii`/`secrets` purpose keys)                      |
| **AES-KW**          | `wrapKey`, `unwrapKey`              | wrap the per-firm key under the root KEK; wrap/unwrap the firm key on load |
| **HKDF**            | `deriveBits`, `deriveKey`           | derive `pii`/`secrets`/`index` purpose keys from the firm key              |
| **HMAC**            | `sign`, `verify`, `generateKey`     | blind-index computation (sign, then truncate)                              |
| **SHA-256/384/512** | digest                              | HKDF/HMAC hash, content addressing                                         |

Implementation notes that affect the design:

- **Non-extractable keys are supported and should be the default.** Import the unwrapped firm key and the derived purpose keys with `extractable: false`. `unwrapKey` and `deriveKey` both return live `CryptoKey` handles whose raw bytes never enter the Worker's JS heap — so a heap dump or a logging mistake cannot leak key material, only the handle. Prefer `deriveKey` (returns a non-extractable key) over `deriveBits` (returns raw `ArrayBuffer`) for the `pii`/`secrets` keys; the `index` key must be derivable to an HMAC `CryptoKey` (it is — `HKDF deriveKey` → `HMAC`), so it also stays non-extractable.
- **AES-GCM IV/nonce: 96-bit, never reused under a given key.** Generate a fresh 12-byte IV per encryption from `crypto.getRandomValues` and store it alongside the ciphertext. With random 96-bit IVs, birthday-bound nonce collision is the constraint; for the per-field volumes here (a firm's sensitive corpus is small) this is comfortable, but the envelope (§B) should carry the IV explicitly rather than derive it, so the safety argument is local and obvious. CipherSweet's own guard against this is an extended-nonce AEAD (XChaCha20-Poly1305 / 256-bit-salt construction) so that nonce reuse is statistically impossible; we are constrained to AES-GCM by ADR-0026's FIPS-friendly primitive set, so **the IV-uniqueness discipline is ours to enforce in code**, not delegated to a wide-nonce cipher. Worth a fitness test asserting random-IV generation on the write path.
- **AES-KW takes no IV** (deterministic key wrap, RFC 3394) — correct for wrapping the firm key; do not substitute AES-GCM there.
- No Workers-specific length restrictions surfaced: AES-256 keys, SHA-384 HKDF/HMAC are all standard.

**Finding:** nothing in ADR-0026's primitive choice is blocked by the runtime. The build can proceed on native Web Crypto with no polyfill and no external crypto dependency.

---

## B. Ciphertext envelope & context binding — the bytes to fix now

ADR-0026 mandates algorithm-versioning but does not specify the envelope. This is the cheapest thing to get right up front and the most expensive to change later (every stored ciphertext is framed by it), so the design cycle should pin it. Research points to a self-describing, versioned, context-bound frame:

**Recommended frame (for the design to ratify or amend):** a compact header + ciphertext, e.g.
`[ algo_version (1–2 bytes) | key_version (1–2 bytes) | iv (12 bytes) | aes-gcm ciphertext+tag ]`, stored base64/blob in the column.

- **`algo_version`** — the PQC/crypto-agility discriminator ADR-0026 already requires. A later hybrid ML-KEM key-wrap or a cipher change is then a versioned rotation, not a schema change.
- **`key_version`** — which generation of the firm key (and, separately, which `index` root key) produced this ciphertext. This is what makes rotation a dual-read migration instead of a flag day (§E). **Bake this in from day one even though rotation machinery is deferred** — it is a single byte now and a full-corpus rewrite to add later.
- **Context binding via AES-GCM AAD — strongly indicated.** CipherSweet's threat model explicitly recommends _"use primary keys as authenticated data"_ so a rogue or injected actor cannot shuffle ciphertexts between rows to correlate values. Pass AAD = a canonical encoding of `{ firm_id, table, field, row primary key, algo_version, key_version }` into `encrypt`/`decrypt`. Because our row primary keys are the `@magna-carta/identifiers` handles (stable, opaque, and already the public id), they are an ideal binding value. Effect: a ciphertext copied to another row/field/firm fails authentication on decrypt. This closes a cut-and-paste hole that at-rest D1 encryption does nothing about, and it is free at encrypt time. The design should decide the **canonical AAD serialization** (it must be byte-identical on write and read).

---

## C. Key hierarchy & derivation — domain separation

CipherSweet's hierarchy is a close analogue of ADR-0026's and validates the shape, with one refinement worth adopting:

- Root → per-firm key is ADR-0026's AES-KW wrap. Good.
- Per-firm key → purpose keys via **HKDF with distinct `info` constants per purpose** (`pii`, `secrets`, `index`). CipherSweet uses HKDF with "carefully-chosen domain-separation constants" and even fixed byte tags (e.g. `0xb4`, `0x7e`) so a key derived for one context can never be repurposed for another. Our `info` strings should be explicit, versioned constants — e.g. `mc:v1:pii`, `mc:v1:secrets`, `mc:v1:index` — never reused across purposes.
- **Per-field / per-index subkeys (the refinement).** CipherSweet does not blind-index every field with the same key; it derives a _distinct subkey per (table, field, index)_ by HMAC-ing the packed `table‖field‖index` name under the index root key. We should mirror this: the `index` purpose key is a **root** for blind indexing, and each indexed field derives its own subkey from it (HKDF `info = mc:v1:index:<table>:<field>:<indexName>`). Why it matters: it means the blind index for `ssn` and the blind index for `account_number` cannot be cross-correlated, and it lets a future per-field reindex be scoped. This is a derivation-string decision — cheap now, structural later.

---

## D. Blind index design — the deep gap (drives Conflicts matching)

This is the part ADR-0026 names but does not specify, and it is ethics-critical because it backs Conflicts. Findings:

### D.1 Construction

A blind index is `truncate( HMAC( normalize(plaintext), perFieldIndexKey ), L_bits )`, stored in its own indexed column. Conflicts then matches with `WHERE <field>_bidx = ?` — an exact lookup over ciphertext-adjacent hashes, never decrypting. (CipherSweet offers a "slow" variant using Argon2id/PBKDF2 instead of a bare HMAC for very-low-entropy inputs; see D.4.)

### D.2 Normalization before hashing is the whole game

The HMAC is exact-match only, so **two values must be byte-identical after normalization to match**. The normalization transform is therefore a _correctness_ decision for Conflicts, not a nicety:

- **SSN / financial IDs:** strip all formatting (dashes, spaces) to digits before hashing, so `123-45-6789` and `123456789` match. Optionally maintain a _second_ blind index over **last-four only** (CipherSweet's `LastFourDigits` transform) to support the common "match on last four" workflow without exposing the full value — but see the entropy warning (D.4).
- **DOB:** normalize to a canonical `YYYY-MM-DD` before hashing.
- **Driver's license:** uppercase + strip formatting; note these are state-namespaced, so the normalized form should include the issuing state (or it becomes a compound index, D.3) or collisions across states become false matches.
- Unicode normalization (NFC) on any free-text-ish identifier so visually identical strings hash identically.

The design must specify a **transform per protected field**, and it must be frozen — changing a normalization rule later silently breaks matching against every previously stored index (a reindex, which needs plaintext).

### D.3 Compound indexes hide low-entropy fields

CipherSweet's strongest practical guidance: never blind-index a low-entropy field alone; combine it. A "first-initial + last-name" or "DOB + last-name" compound index leaks far less than either field's standalone index, because the observable equality class is the _combination_. Relevant here because several of our protected fields are low-entropy (next point).

### D.4 Entropy is the safety parameter — and DOB is the problem child

The threat model gives an explicit coincidence formula:

> `C = R / 2^( Σ min(L_i, K_i) )`, target `2 ≤ C < √R`,

where `R` = encrypted records, `L_i` = index output bits, `K_i` = the field's input keyspace (bits). The binding term is `min(L, K)` — **truncating the output past the field's own entropy buys nothing**, and a low-entropy field leaks regardless of how you tune `L`.

Estimated keyspaces for our protected set:

| Field                       | Approx. entropy `K`        | Standalone blind index?                                                 |
| --------------------------- | -------------------------- | ----------------------------------------------------------------------- |
| SSN (full, 9 digits)        | ~27–30 bits                | Yes — safe, tune `L` to keep `C` in range                               |
| Financial / account numbers | high (varies)              | Yes                                                                     |
| Driver's license            | medium, state-dependent    | Yes if state-namespaced                                                 |
| SSN last-four               | ~13 bits                   | **No** — too low alone; only as compound or accept the leak             |
| **DOB**                     | **~15 bits** (adult range) | **No** — fingerprintable; use compound (DOB+name) or do not blind-index |

**Finding for the design:** treat the protected fields as two classes — _high-entropy identifiers get standalone blind indexes_ (SSN, account numbers, DL), and _low-entropy attributes (DOB, last-four) are matched only via compound indexes or not blind-indexed at all_ (Conflicts can decrypt-and-compare DOB on the small candidate set returned by a higher-entropy match, since decrypt is already a permitted, audited operation inside the engine). This keeps DOB out of the leak surface while preserving the matching workflow. Per-field `L_bits` should be derived from the `C`/`R` formula against the expected per-firm directory size, not picked by feel.

### D.5 What a blind index leaks (accept knowingly)

With DB-only access an attacker learns **equality** (same index value ⇒ probably same normalized plaintext, softened by truncation false-positives) and, across many rows, **distribution/frequency**. They do **not** learn plaintext, ordering, or substrings. The dangerous amplifier is _many distinct indexes on one field_ or _indexes on binary/low-entropy fields_ — both let frequency analysis converge. Mitigations to carry into the design: minimize index count per field, prefer compound indexes for low-entropy fields, and keep AAD/primary-key binding (§B) so rows cannot be shuffled to manufacture correlations.

### D.6 Hard limit — exact match only, and how Conflicts lives with it

An HMAC blind index **cannot do fuzzy, phonetic, range, or prefix matching** — by design (it is a keyed hash). This cleanly partitions Conflicts matching, and the partition is worth stating explicitly for the Directory/Conflicts design:

- **Encrypted identifiers (SSN, DL, account #):** exact match via blind index. This is the right semantic — you _want_ an exact SSN hit, not a fuzzy one.
- **Names and other non-encrypted fields:** these are **not** in the protected set (ADR-0026 deliberately leaves names in plaintext precisely so fuzzy/phonetic dedup and conflicts matching work). Fuzzy/phonetic/alias matching happens on plaintext columns, unaffected by `protected()`.

So the blind index is _one input_ to Conflicts (the exact-identifier channel), not the whole engine. The slice 1·3 Conflicts research should treat fuzzy-name matching as an entirely separate, plaintext mechanism.

---

## E. Rotation & crypto-shred — what the seam must reserve now

ADR-0026 defers rotation machinery but says "only the seam is built now." Concretely, the seam is the **version columns** (§B) plus a few invariants:

- **Crypto-shred** is free and immediate: destroy the firm's wrapped key in the control-plane registry and the entire AES-GCM corpus is unreadable. No machinery needed — just ensure no plaintext-cached copies and that purpose keys are only ever derived in-memory.
- **Root-KEK rotation = rewrap only.** Unwrap each firm key under the old root, rewrap under the new root, update the registry. No field data is touched. Requires the registry row to carry a root-key-version. Cheap; can be built when first needed.
- **Per-firm key rotation = re-encrypt the firm's small sensitive set.** Read (decrypt with old `key_version`), write (encrypt with new). The `key_version` byte in the envelope lets old and new coexist during the pass — dual-read by version. This is why the byte must exist from day one.
- **Blind-index rotation is the expensive one and couples to plaintext.** Rotating the `index` root key (or changing a normalization transform) requires recomputing every affected blind index, which requires the plaintext, i.e. a full decrypt-then-reindex pass. Implications: (1) give blind-index storage its own `index_key_version` so a reindex can run online with dual-read; (2) treat normalization transforms as frozen contracts (D.2); (3) accept that index-key rotation is a deliberate maintenance job, not routine. Nothing to build now beyond the version column, but the design should _document_ this cost so no one assumes blind-index rotation is as cheap as KEK rewrap.

---

## F. TOTP seed handling — resolving the ADR-0026 open question

ADR-0026 leaves TOTP seeds as "encrypted via a Better Auth field hook into the same crypto module **or** accepted under Better Auth's at-rest handling." Research clarifies the trade and surfaces a structural tension:

**What Better Auth does today.** The 2FA plugin stores the TOTP secret and backup codes in a dedicated `twoFactor` table (`secret`, `backupCodes`, `verified`), and **encrypts both at rest with the app-level auth secret** via its `symmetricEncrypt` path. Recent versions support an **`encryptionKeys` array** (an envelope format with key rotation — first entry encrypts, the rest decrypt legacy data; the singular `secret` is the legacy fallback). So Better Auth is _not_ storing TOTP seeds in plaintext — it already does app-secret symmetric encryption with a rotation story. (Confidence medium on exact current internals; verify against the pinned Better Auth version at build time.)

**The structural tension.** The `protected()` chokepoint lives in the **per-firm data-access layer** and is keyed by the **per-firm** key (enabling per-firm crypto-shred + audit). But TOTP seeds live in **control-plane** Better Auth tables, keyed to a **user**, not a firm. Routing them through `protected()` would mean either (a) reaching the per-firm key from a control-plane auth path (a layering inversion — auth runs before/around firm scoping), or (b) building a parallel control-plane crypto path. Neither is free, and the payoff is thin: TOTP seeds are not firm-confidential data in the way SSNs are, and per-firm crypto-shred of an auth secret is not obviously meaningful (the user, not the firm, owns the 2FA enrolment).

**Options for the design cycle (recommendation, not decision — auth/crypto is Fable's call):**

1. **Accept Better Auth's at-rest encryption** (app-secret + `encryptionKeys` rotation). Lowest complexity; keeps the auth boundary clean; the seed is already enveloped and rotatable. Cost: the seed is protected by the _app_ secret (a Worker secret, same trust tier as the root KEK), not a per-firm key, and not under our audit/role chokepoint. **This looks like the right default** given the layering, provided the app secret is a managed Worker secret distinct from other secrets and the `encryptionKeys` rotation array is configured.
2. **Better Auth database hook → `protected()`-style encryption** under a dedicated control-plane purpose key (not the per-firm key). Keeps a single crypto module and audit trail, avoids the per-firm layering inversion. Medium complexity; the realistic "route through our module" interpretation of ADR-0026.
3. Per-firm `protected()` — **rejected on layering grounds** above.

The decision hinges on whether the firm wants TOTP seeds inside the audited crypto chokepoint or is content with Better Auth's own (now envelope-based) at-rest encryption. Either way, the seam is small — this is a Phase-0/1 wiring choice, not a structural commitment, and ADR-0026's TOTP line can be closed with a one-paragraph amendment once chosen.

---

## G. Consolidated open decisions for the slice 1·2 design cycle

1. **Envelope byte layout** — ratify `[algo_version | key_version | iv | gcm ct+tag]` (or amend). (§B)
2. **AAD canonical serialization** — fix the exact byte encoding of `{firm_id, table, field, row pk, versions}`; must be identical write/read. (§B)
3. **HKDF `info` constants** — the versioned domain-separation strings for `pii`/`secrets`/`index` and the per-field index subkey derivation. (§C)
4. **Per-field protected-set table** — for each of SSN / DOB / DL / financial IDs / plugin creds / TOTP: encrypt? blind-index (standalone vs compound vs none)? normalization transform? `L_bits`? (§D)
5. **DOB / low-entropy policy** — confirm DOB is compound-or-decrypt-compare, not standalone blind index. (§D.4)
6. **`L_bits` per field** — compute from `C = R/2^(Σ min(L,K))` against an assumed per-firm directory size. (§D.4)
7. **Version columns now** — `key_version` on protected payloads, `index_key_version` on blind-index rows, root-key-version on the registry; even though rotation machinery is deferred. (§E)
8. **TOTP seed handling** — pick option 1 or 2 (§F) and close the ADR-0026 open line.
9. **Fitness tests** — random-IV-on-write assertion; "no plaintext for a `protected()` field reaches a non-DAL path" source scan; AAD-mismatch decrypt-fails test.

The Conflicts-matching consequences (D.6 — exact identifier channel vs plaintext fuzzy channel) should be carried forward as an input to the **slice 1·3 Directory/Conflicts** research, not resolved here.

---

## Sources

- [Web Crypto · Cloudflare Workers docs](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [CipherSweet — Security Properties and Threat Model](https://ciphersweet.paragonie.com/security)
- [CipherSweet — Blind Indexing internals](https://ciphersweet.paragonie.com/internals/blind-index)
- [CipherSweet — Key Hierarchy](https://ciphersweet.paragonie.com/internals/key-hierarchy)
- [Paragon Initiative — "CipherSweet: Searchable Encryption Doesn't Have to be Bitter" (2019)](https://paragonie.com/blog/2019/01/ciphersweet-searchable-encryption-doesn-t-have-be-bitter)
- [Better Auth — Two-Factor Authentication (2FA) plugin](https://better-auth.com/docs/plugins/2fa)
- [Better Auth — Security reference](https://better-auth.com/docs/reference/security)
