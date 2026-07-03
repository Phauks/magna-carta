# PDF Secure — Unlock & Protect (slice 5, secure/encrypt half) — Design

**Status:** Design · **Date:** 2026-06-26 · **Owner:** Trevor Goldsmith
**Branch:** pdf-secure-encrypt (off merged main)
**Roadmap home:** [`2026-06-21-rust-pdf-engine-roadmap-design.md`](2026-06-21-rust-pdf-engine-roadmap-design.md) — slice 5 (forms + **secure/encrypt**); forms shipped, this completes the slice.
**Reuse:** the `lopdf` object model already linked by `redact`/`scrub`/`forms`/`detect`; the additive byte-to-byte transform shape of `sanitizeDocument`; the `packages/pdf` WASM binding's `ensureReady` + handle pattern; the Tools catalog row + access-control permission pattern (`metadata-scrubber`, `file-hash-integrity`).
**Relates to:** ADR-0026 (envelope key management — AES-256 doctrine) · ADR-0046 (post-quantum agility-first posture) · ADR-0045 (PAdES platform seal — the *next* slice; decrypt is a dependency of signing an encrypted input).
**ADRs to raise:** `pdf-secure-encrypt` (adopt `lopdf`'s Standard Security Handler; write AES-256 only; permission flags are advisory, stated).

---

## Goal

Two engine primitives plus one Tools surface:

1. **Unlock (decrypt).** Open a password-protected PDF so every other engine operation — render,
   redact, sanitize, detect, forms, Bates — works on it. This is the high-value half: encrypted PDFs
   arrive constantly in legal work (opposing counsel, banks, courts), and today every feature chokes
   on them at parse time.
2. **Secure (encrypt).** Produce a password-protected copy with **AES-256** and a permissions policy
   — "protect this before it leaves the firm."
3. **"Unlock & Secure PDF"** — an ethereal Tools-area tool in the `documents` group that runs both,
   **client-side**, so the password and plaintext never leave the browser.

---

## The reframe — the crypto already exists (verified)

The whole-engine roadmap (§4) listed encrypt/secure as `lopdf (partial) → build missing modes`.
Verified against the `lopdf 0.41` source (golden rule 11), that is now too pessimistic. `lopdf`
implements the **full Standard Security Handler, bidirectionally**:

| Revision / version | Algorithm | Read | Write |
| --- | --- | --- | --- |
| R2/R3, V1/V2 | RC4 (40–128) | ✅ | ✅ (we **won't** emit) |
| R4, V4 `/AESV2` | AES-128-CBC | ✅ | ✅ (we **won't** emit by default) |
| R6, V5 `/AESV3` | AES-256-CBC + SHA-2 (alg 2.B) | ✅ | ✅ **(our write target)** |

Public surface we build on: `EncryptionVersion::V5 { encrypt_metadata, owner_password, user_password,
permissions, .. }`, `Document::encrypt(&state)`, `EncryptionState::encode()`,
`encrypt_object`/`decrypt_object`, the `Aes256CryptFilter`/`Aes128CryptFilter`/RC4 crypt filters.

**So this slice is integration + policy, not a crypto implementation.** What we own: a clean decrypt
primitive, an AES-256-only write path, the firm permissions model, and the honest framing of what PDF
permissions actually guarantee. No hand-rolled cipher code — `lopdf` pulls `aes`/`sha2`/`md-5`
(RustCrypto, pure Rust → clean under golden rule 14; no C-dependency consent needed).

---

## Scope

**In:**
- **Decrypt** any handler revision (RC4, AES-128, AES-256) given the correct password — read broadly.
- **Secure** with **AES-256 (V5/R6) only** — write strictly. Owner password, optional user (open)
  password, a permissions policy, and an `encryptMetadata` toggle.
- Decrypt-on-load: `Document::load` accepts an optional password so render/inspect work on protected
  inputs without a separate unlock step.
- The client-side Tools surface.

**Out (stated, with reason):**
- **Emitting RC4 or AES-128** — weaker than the AES-256 doctrine (ADR-0026). A documented
  reader-compat escape hatch (`Aes128`) is designed for but defaults off and is not surfaced in the
  Tools UI in v1.
- **Password recovery / cracking** — that is the separate Decryption & Recovery tool's job; this tool
  unlocks with a *known* password only.
- **Public-key (certificate) security handlers** — recipient-certificate encryption is rare in this
  domain; detect and report, don't implement.
- **Digital signatures / PAdES** — the next slice (ADR-0045). Decrypt here is a dependency of it.

---

## Engine API (`crates/pdf-core`)

Two new modules, `decrypt.rs` and `secure.rs`, exported from `lib.rs`.

```rust
// decrypt.rs ───────────────────────────────────────────────────────────────────
/// Decrypt a protected PDF to plaintext bytes: every string/stream is decrypted and
/// the /Encrypt dictionary is dropped, so the result parses in any engine (hayro
/// included) with no password. A document that is not encrypted is returned
/// byte-for-byte unchanged (callers need not pre-check). Wrong password → typed error.
pub fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError>;

/// What kind of protection a document carries, without attempting to open it.
/// Lets the UI ask for a password only when one is needed, and warn on unsupported
/// (public-key) handlers.
pub fn inspect_security(bytes: &[u8]) -> Result<SecurityInfo, SecureError>;

pub struct SecurityInfo {
    pub encrypted: bool,
    pub handler: Handler,            // Standard | PublicKey | None
    pub algorithm: Algorithm,        // Rc4 | Aes128 | Aes256 | None
    pub has_user_password: bool,     // an open password is required to view
    pub permissions: Permissions,    // the declared permission bits (advisory — see below)
}

// secure.rs ────────────────────────────────────────────────────────────────────
/// Encrypt to AES-256 (V5/R6). `user_password = None` produces a document that opens
/// without a prompt but still enforces the owner password for permission changes.
pub fn secure(bytes: &[u8], opts: &SecureOptions) -> Result<Vec<u8>, SecureError>;

pub struct SecureOptions {
    pub owner_password: String,            // required — controls permissions
    pub user_password: Option<String>,     // optional — the "open" password
    pub permissions: Permissions,
    pub encrypt_metadata: bool,            // default true
    pub algorithm: WriteAlgorithm,         // default Aes256; Aes128 behind an explicit opt-in
}

/// Advisory permission policy. These map to the standard /P bits.
pub struct Permissions {
    pub print: bool,
    pub print_high_res: bool,
    pub copy: bool,           // extract text/graphics
    pub modify: bool,
    pub annotate: bool,
    pub fill_forms: bool,
    pub assemble: bool,       // insert/rotate/delete pages
    pub accessibility_copy: bool,
}

pub enum WriteAlgorithm { Aes256, Aes128 }
pub enum Handler { Standard, PublicKey, None }
pub enum Algorithm { Rc4, Aes128, Aes256, None }

pub enum SecureError {
    Parse,
    WrongPassword,
    UnsupportedHandler,   // public-key / certificate security
    Reassemble,
}
```

`Document::load` gains a sibling `Document::load_protected(bytes, password)` (or an
`Option<&str>` password param) that runs `decrypt` first, then the existing `Pdf::new`. The plain
`load` is unchanged for the common path.

### The one technical risk — the two-parser handoff

`pdf-core` parses with **two** crates: `hayro` (render) and `lopdf` (model — what every mutating op
already uses). `hayro` does not own the decryption. The resolution keeps the architecture clean:
**`decrypt` is a byte→byte transform via `lopdf`** (load → `decrypt_object` over the object graph →
drop `/Encrypt` from the trailer → save). It produces ordinary plaintext PDF bytes, which then feed
*whichever* parser the downstream op uses. The two-parser split never has to coordinate on keys —
decrypt once to bytes, parse the bytes. **Build-time spike (≤1 day):** confirm `lopdf` exposes a
whole-document decrypt (or assemble it from `decrypt_object` + trailer surgery), and that a re-saved
decrypted document round-trips through `hayro` render and through `redact`/`detect`.

### Permissions honesty (stated in code docs and UI)

PDF permission bits are **advisory**: they are enforced only by cooperating viewers and are trivially
stripped by any tool that has the document open (every permission bit lives under the *owner*
password, and a document with no user password is readable by anyone). The **only** real
confidentiality control is the **user (open) password** + the AES-256 cipher. The engine doc comments
and the Tools UI both say this plainly — overselling permission flags as security would be a
malpractice trap in a legal product. We expose them because clients and courts ask for them, not
because they protect anything.

---

## WASM binding (`packages/pdf/src/index.ts`)

Mirrors the existing async-over-`ensureReady` functions:

```ts
export interface SecurityInfo {
  encrypted: boolean;
  handler: "standard" | "publicKey" | "none";
  algorithm: "rc4" | "aes128" | "aes256" | "none";
  hasUserPassword: boolean;
  permissions: Permissions;
}
export interface Permissions { /* the eight booleans above */ }
export interface SecureOptions {
  ownerPassword: string;
  userPassword?: string;
  permissions?: Partial<Permissions>;   // omitted bits default to permissive
  encryptMetadata?: boolean;            // default true
}

export function inspectSecurity(bytes: Uint8Array): Promise<SecurityInfo>;
export function decryptDocument(bytes: Uint8Array, password: string): Promise<{ pdf: Uint8Array }>;
export function secureDocument(bytes: Uint8Array, options: SecureOptions): Promise<{ pdf: Uint8Array }>;
```

A `WrongPassword` engine error marshals to a typed thrown error the UI distinguishes from a parse
failure (so it can re-prompt rather than show "corrupt file"). **No password is ever logged** — the
binding never includes it in an error message or console output (golden rule 4; the secrets
invariant).

---

## Tools surface — "Unlock & Secure PDF"

One catalog row (`packages/tools/src/catalog.ts`), one permission (`packages/access-control`), one
SPA shell `id → component` mapping:

```ts
{
  id: "pdf-secure",
  name: "Unlock & Secure PDF",
  icon: "file-lock-2",
  subjectGroup: "documents",
  permission: assertPermission("tools:pdfSecure"),
  contextTags: ["file", "none"],
  backing: { kind: "library" },   // client-side WASM
  matterContext: "none",
}
```

**Client-side by default — the privacy decision.** Unlike the metadata tool (whose engine is
TypeScript and round-trips base64 to the worker), the PDF engine is WASM and the `packages/pdf`
binding runs in the browser. The tool runs `inspectSecurity` → `decryptDocument` / `secureDocument`
entirely client-side: **the password and the document bytes never leave the browser.** For an unlock
tool handling privileged material, that is the right default and matches the platform's
client-side-by-default doctrine (white paper _Delivery model_).

**Dependency to confirm at build:** this requires the `pdf-core` WASM to be loadable in the SPA
bundle. If that plumbing is not yet wired (the viewer/consumer-surface work is still open on the
roadmap), the fallback is a metadata-style worker route (`apps/worker/src/routes/pdf-secure.ts`,
chokepoint-gated on `tools:pdfSecure`, `audited:false`, `rateLimit:"expensive"`, nothing stored). The
fallback transmits the password + document to the *firm's own* trusted, ephemeral worker (acceptable,
not stored) but is strictly weaker than client-side. **Recommendation: client-side; wire the SPA WASM
load as part of this slice if it isn't already.**

**UX shape (two modes in one tool):**
- Drop a file → `inspectSecurity` runs immediately. If encrypted, prompt for the password and offer
  **Unlock** (download the decrypted copy). If it carries an unsupported (public-key) handler, say so
  and stop.
- **Secure** mode: set an open password and/or owner password, toggle the permission checkboxes (with
  the advisory caveat shown inline), choose whether to encrypt metadata → download the protected copy.

---

## Security & invariants

- **Pure compute, no persistence.** Password bytes in, document bytes out. Nothing is stored; the tool
  is ethereal (`matterContext: "none"`).
- **No password in logs or errors.** Engine, binding, and (if used) route never echo the password or
  document content. Typed `WrongPassword` carries no payload (golden rule 4; secrets invariant).
- **Write AES-256 only** by default — never silently downgrade to RC4/AES-128 (ADR-0026).
- **Error pipeline at the edge.** The core returns typed `Result`s; Error-ID correlation and redaction
  live at the consuming surface, not in the portable core (same boundary as the rest of `pdf-core`).

---

## Testing

- **Rust unit (`crates/pdf-core`):** round-trip `secure` → `decrypt` for AES-256 with/without a user
  password; decrypt fixtures for RC4, AES-128, AES-256 (correct password → plaintext; wrong password →
  `WrongPassword`); `inspect_security` classification incl. an unencrypted file (unchanged bytes) and
  a public-key handler (`UnsupportedHandler`); permission bits survive a `secure` round-trip; a
  secured document renders via `hayro` after `decrypt` (the two-parser proof).
- **Binding (`packages/pdf`):** `inspectSecurity`/`decryptDocument`/`secureDocument` over the WASM,
  wrong-password throws the distinguishable error, no password leaks into thrown messages.
- **Fixtures:** a tiny generated set per algorithm (built in-repo, not checked-in third-party PDFs),
  matching how `forms`/`bates` fixtures are produced.

---

## Open items to confirm at build (golden rule 11)

1. **The two-parser spike** above — `lopdf` whole-document decrypt + `hayro` round-trip.
2. **SPA WASM load** — is `pdf-core` WASM already loadable in the web bundle, or is wiring it part of
   this slice? Decides client-side vs the worker-route fallback.
3. **WASM bundle-size delta** from linking the crypto path (`aes`/`sha2`) — measure against the
   slice-1 budget; the cipher code is small but confirm.
4. **`lopdf 0.41` API specifics** — exact call for whole-document decrypt and for `V5` build; re-verify
   version/license at build (it may have advanced).
5. **Permission-bit mapping** — confirm the eight-boolean model against the `/P` bit layout `lopdf`
   expects, including the R6 high-order bits.
