# @magna-carta/encryption — CLAUDE.md

**Purpose.** The pure cryptographic primitives below the `protected()` field type: the versioned
ciphertext envelope, the non-extractable key hierarchy (root KEK → AES-KW-wrapped per-firm keys →
HKDF-SHA-384 purpose/index keys), AAD context binding, blind-index computation, and the frozen
normalization transforms. It operates on **injected `CryptoKey` handles and plain values only** — no
D1, no Hono, no `env`, no I/O. The enforcement layer (permission check, audit row, the firm-key
provider, the secrets store) lives in `@magna-carta/data-access`; this package is the algorithm.

**White paper:** _Encryption and key management_ —
[`docs/Magna-Carta-White-Paper.md`](../../docs/Magna-Carta-White-Paper.md). (ADR-0026, ADR-0046,
ADR-0084.)
**Spec:**
[`docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md`](../../docs/specs/2026-06-12-slice-1-2-protected-crypto-module-design.md).

## Key files / entry points

- `src/aad.ts` — `serializeAad` — the canonical additional-authenticated-data string fed into every
  encrypt/decrypt
- `src/envelope.ts` — `encodeEnvelope`/`decodeEnvelope` — the versioned binary frame
  (`[algoVersion | keyVersion | iv | AES-256-GCM ciphertext+tag]`, base64 TEXT)
- `src/keys.ts` — the key hierarchy: `importRootKek`, `generateFirmKeyBytes`, `wrapFirmKey`,
  `unwrapFirmKeyToHkdfKey`, `deriveAesGcmPurposeKey`, `deriveIndexSubkey`
- `src/normalize.ts` — the frozen blind-index normalization transforms (`normalizeToDigits`,
  `normalizeUppercaseStrip`, `withStatePrefix`, `toNfc`)
- `src/blind-index.ts` — `computeBlindIndex` — version-prefixed truncated HMAC-SHA-384
- `src/protect.ts` — `encryptProtectedValue`/`decryptProtectedValue` — the seal/open pair tying the
  envelope, AAD, and purpose key together

## Invariants that apply here

- **The constants are FROZEN — a change is a NEW version, never an edit.** Every value below is
  pinned by committed golden vectors (`test/golden/`); changing one in place would silently break
  every value already sealed under it. To evolve any of them, add a new version alongside the old and
  read both during migration — never edit:
  - the AAD format string `mc:aad:v1|firm|table|field|row_pk|algo_version|key_version` (a new layout
    is `mc:aad:v2`, a new prefix);
  - the HKDF salt `magna-carta-protected-v1` and the info strings `mc:v1:pii`, `mc:v1:secrets`, and
    the per-field index info `mc:v1:index:<table>:<field>:<index_name>` (a new schema is a new info
    prefix);
  - the normalization transforms in `normalize.ts` (a change moves which values collide → a new
    `indexName`, which derives a new subkey);
  - the envelope `algoVersion`/`keyVersion` bytes (a new cipher is a new `algoVersion`, frames
    stamped with an older version must keep decoding);
  - the blind-index `"1:"` version prefix (a new scheme is `"2:"`, both readable during a dual-read
    rotation).
- **Non-extractable keys, end to end.** Every `CryptoKey` this package produces is
  `extractable: false`. Raw bytes enter exactly twice — `generateFirmKeyBytes` (mint) and
  `importRootKek` (the root KEK) — and never surface again: `unwrapFirmKeyToHkdfKey` imports the
  recovered firm key straight into a non-extractable HKDF base key (the plaintext never reaches JS),
  and every derived purpose/index key is non-extractable too. `deriveBits` is never used (it would
  put raw bytes in the heap); `deriveKey` is.
- **One IV source.** The only `crypto.getRandomValues` initialization-vector draw in the entire
  package is in `encryptProtectedValue` — a fresh random 12-byte IV per seal, so no IV is reused
  under a key. (The other `getRandomValues` call, `generateFirmKeyBytes`, mints a key, not an IV.)

## Dependencies & contracts

- Depends only on `@magna-carta/identifiers` (types). No runtime dependencies — native Web Crypto
  (`crypto.subtle`) + `btoa`/`atob`, available on the Workers runtime and Node alike.
- Pure and side-effect-free: callers pass in `CryptoKey` handles and values and receive values back.
  The firm-key provider, the permission gate, the decrypt-audit row, and the `firm_secret` store are
  all the data-access layer's job, not this package's.

## Gotchas

- AES-KW wraps a key in its "raw" form, which requires an _extractable_ source key — and WebCrypto
  forbids extractable HKDF keys. So `wrapFirmKey` imports the freshly minted bytes as a throwaway
  extractable AES key used **only** for the wrap step (AES-KW copies the 32 bytes verbatim, so the
  carrier algorithm is irrelevant); the persisted artefact is the wrapped ciphertext, never the raw
  bytes.
- `arrayBufferView` copies into a fresh `ArrayBuffer`-backed view before each `crypto.subtle` call —
  a `Uint8Array` from a slice or `TextEncoder` does not satisfy `BufferSource` directly on every
  runtime.
- DOB and SSN last-four are deliberately **never** given a standalone blind index (too low-entropy —
  frequency-fingerprintable at any truncation); they match by decrypt-and-compare on a higher-entropy
  candidate set. The policy lives with the field declarations in `@magna-carta/data-access`, not
  here.
