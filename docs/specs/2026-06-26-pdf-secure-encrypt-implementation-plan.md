# PDF Secure — Unlock & Protect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** Add `decrypt` (unlock any handler revision with a known password) and `secure` (write AES-256 protection + permissions) to `crates/pdf-core`, expose both through the `packages/pdf` WASM binding, and ship an ethereal client-side **"Unlock & Secure PDF"** Tools-area tool.

**Architecture:** New `crates/pdf-core/src/decrypt.rs` and `src/secure.rs`, exported from `lib.rs`. Both lean entirely on `lopdf`'s Standard Security Handler (already linked by `redact`/`scrub`/`forms`/`detect`) — no hand-rolled crypto. `decrypt` is a byte→byte transform: load, decrypt the object graph, drop `/Encrypt`, save — its plaintext output then feeds `hayro` and every existing op unchanged.

**Tech Stack:** Rust, lopdf 0.41 (`encryption` module: `EncryptionVersion::V5`, `Document::encrypt`, `decrypt_object`, crypt filters), hayro (tests, to prove a decrypted doc renders). RustCrypto (`aes`/`sha2`/`md-5`) arrives transitively through lopdf — pure Rust, clean under golden rule 14.

## Global Constraints

- Pure-compute: typed `Result`, no logging, no `unwrap`/`panic` on input data outside tests.
- **Never put a password (or document bytes) in a log line, error payload, panic message, or console output** — engine, binding, and any route. `WrongPassword` carries no data. (golden rule 4; secrets invariant)
- **Write AES-256 only by default.** Never silently downgrade. The `Aes128` write path exists but is opt-in and not surfaced in the UI. Never emit RC4. (ADR-0026)
- **Permissions are advisory — say so** in code docs and UI. The only real protection is the user/open password + the cipher. Do not imply permission bits enforce anything.
- No process references in source/tests/README/consumer strings; full names; changelog/ADR via fragments. (golden rules 12, 13, 5)
- Reuse before building: the `lopdf` document already loaded by sibling modules; the `ensureReady`/handle pattern in `packages/pdf`; the Tools catalog + access-control patterns.

## Interfaces produced

```rust
// decrypt.rs
pub fn inspect_security(bytes: &[u8]) -> Result<SecurityInfo, SecureError>;
pub fn decrypt(bytes: &[u8], password: &str) -> Result<Vec<u8>, SecureError>;
pub struct SecurityInfo { pub encrypted: bool, pub handler: Handler, pub algorithm: Algorithm,
    pub has_user_password: bool, pub permissions: Permissions }
pub enum Handler { Standard, PublicKey, None }
pub enum Algorithm { Rc4, Aes128, Aes256, None }
// secure.rs
pub fn secure(bytes: &[u8], opts: &SecureOptions) -> Result<Vec<u8>, SecureError>;
pub struct SecureOptions { pub owner_password: String, pub user_password: Option<String>,
    pub permissions: Permissions, pub encrypt_metadata: bool, pub algorithm: WriteAlgorithm }
pub struct Permissions { pub print: bool, pub print_high_res: bool, pub copy: bool, pub modify: bool,
    pub annotate: bool, pub fill_forms: bool, pub assemble: bool, pub accessibility_copy: bool }
pub enum WriteAlgorithm { Aes256, Aes128 }
pub enum SecureError { Parse, WrongPassword, UnsupportedHandler, Reassemble }
// lib.rs additions
pub fn Document::load_protected(bytes: Vec<u8>, password: &str) -> Result<Self, PdfError>;
```

`Permissions::default()` is fully permissive (all true) — a secured doc with no explicit policy restricts nothing but the owner-password gate.

---

### Task 1: Probe spike — confirm the lopdf decrypt + hayro round-trip

**Files:** a throwaway `#[test]` in `crates/pdf-core/src/decrypt.rs` (kept or deleted per outcome).

Resolve the design's one open risk before building on it. Build a tiny AES-256 encrypted fixture (`secure` isn't written yet — encrypt it with lopdf directly in the test, or hand-craft via `Document::encrypt`), then confirm the exact `lopdf 0.41` call for **whole-document decryption** (`Document::decrypt` if present, else assemble from `decrypt_object` over every string/stream + remove the trailer `/Encrypt` + clear the saved `EncryptionState`).

- [ ] **Step 1:** write `probe_decrypt_roundtrips_through_hayro`: encrypt a 1-page doc (AES-256, user password `"open"`) → `decrypt(bytes, "open")` → the result has **no `/Encrypt`** in its trailer, and `Document::load(result)` (hayro) renders page 0 to a non-empty raster.
- [ ] **Step 2:** make it pass with the real lopdf API. Record the confirmed decrypt call in a code comment.
- [ ] **Step 3:** `cargo test -p pdf-core decrypt::probe` (from `crates/`) green. If lopdf has no whole-doc decrypt and the assembled path proves infeasible in a day, STOP and report (fall back: server-side route using lopdf in the worker). Do not silently change scope.

---

### Task 2: `inspect_security` + shared types

**Files:** create `crates/pdf-core/src/decrypt.rs` (types + `inspect_security`); modify `lib.rs` (`mod decrypt;` + re-exports). `SecureError` lives here; `secure.rs` re-uses it.

Read the trailer `/Encrypt` dictionary **without** needing a password: `/Filter` (`/Standard` → Standard handler; `/Adobe.PPKLite`/`/Adobe.PubSec` → PublicKey → report, don't open); `/V`+`/R`+the crypt-filter `/CFM` (`/V2`→Rc4, `/AESV2`→Aes128, `/AESV3`→Aes256); `has_user_password` from whether the empty user password validates (a doc with only an owner password opens with no prompt); `/P` → the eight permission booleans (respect the R6 high bits).

- [ ] **Step 1: failing tests**
  - `inspect_unencrypted_is_clean`: a plain PDF → `encrypted == false`, `handler == None`, `algorithm == None`.
  - `inspect_aes256_userpw`: an AES-256 doc with a user password → `Aes256`, `has_user_password == true`.
  - `inspect_aes256_owneronly`: AES-256 with owner password only → `has_user_password == false`.
  - `inspect_rc4_and_aes128`: RC4 and AES-128 fixtures classify correctly.
  - `inspect_publickey_handler`: a `/Adobe.PubSec` filter → `Handler::PublicKey` (no panic).
  - `permissions_decode`: a `/P` with copy disabled → `permissions.copy == false`, others as set.
- [ ] **Step 2-4:** FAIL → implement → `cargo test -p pdf-core decrypt::` green; whole crate green; clippy `--all-targets -D warnings` + fmt clean.
- [ ] **Step 5:** commit `feat(pdf-core): inspect PDF security (handler, algorithm, permissions)`.

---

### Task 3: `decrypt`

**Files:** modify `decrypt.rs`, `lib.rs` (re-export `decrypt`).

`decrypt(bytes, password)`: if `inspect_security` says not encrypted → return `bytes.to_vec()` unchanged. If `Handler::PublicKey` → `UnsupportedHandler`. Else load, attempt decryption with `password` (wrong → `WrongPassword`, distinct from `Parse`), strip `/Encrypt`, `save_to` (→`Reassemble`). The output is plaintext that any parser opens.

- [ ] **Step 1: failing tests**
  - `decrypt_aes256_correct_password`: round-trips; output trailer has no `/Encrypt`; text/page count preserved.
  - `decrypt_wrong_password_errs`: `decrypt(enc, "nope")` → `Err(WrongPassword)` (not `Parse`).
  - `decrypt_unencrypted_is_identity`: a plain PDF in → equal page count out, no error.
  - `decrypt_rc4_and_aes128`: legacy fixtures decrypt with the right password.
  - `decrypt_then_redact`: decrypt an AES-256 doc → feed the bytes to `redact`/`detect` → they run (the cross-module proof).
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): decrypt password-protected PDFs to plaintext`.

---

### Task 4: `secure` (AES-256 write) + permissions

**Files:** create `crates/pdf-core/src/secure.rs`; modify `lib.rs` (`mod secure;` + re-export `secure`, `SecureOptions`, `Permissions`, `WriteAlgorithm`).

`secure(bytes, opts)`: load (→`Parse`); build an `EncryptionVersion::V5 { encrypt_metadata, owner_password, user_password (default to owner if None for key derivation per spec), permissions: <packed /P>, .. }`; `Document::encrypt(&state)`; `save_to` (→`Reassemble`). `WriteAlgorithm::Aes128` selects the V4/AESV2 builder instead; default `Aes256`. Pack the eight booleans into the `/P` bitfield (and R6 bits) exactly as lopdf expects.

- [ ] **Step 1: failing tests**
  - `secure_then_decrypt_roundtrips`: `secure` (user password `"open"`) → `decrypt(_, "open")` → original page count; rendering works.
  - `secure_owner_only_opens_without_userpw`: `user_password: None` → `inspect_security` reports `has_user_password == false`; `decrypt(_, "")` opens.
  - `secure_wrong_password_fails_decrypt`: `decrypt(secured, "wrong")` → `WrongPassword`.
  - `secure_permissions_survive`: disable `copy` + `modify` → `inspect_security` on the output reflects both off.
  - `secure_defaults_to_aes256`: output `inspect_security.algorithm == Aes256`.
  - `secure_aes128_optin`: `WriteAlgorithm::Aes128` → output classifies as `Aes128`.
- [ ] **Step 2-4:** FAIL → implement → green; clippy + fmt.
- [ ] **Step 5:** commit `feat(pdf-core): secure PDFs with AES-256 + a permissions policy`.

---

### Task 5: `Document::load_protected` + WASM binding

**Files:** modify `crates/pdf-core/src/lib.rs` (`load_protected`) and `src/wasm.rs` (`#[wasm_bindgen]` adapters); modify `packages/pdf/src/index.ts` + add `packages/pdf/test/secure.test.ts`.

`Document::load_protected(bytes, password)` = `decrypt` then the existing `Pdf::new`. WASM: `inspectSecurity`, `decryptDocument`, `secureDocument` returning the shapes in the design; marshal `WrongPassword` to a thrown error the binding tags (e.g. a `code` field) so the UI re-prompts. The binding never includes the password in any thrown message.

- [ ] **Step 1: failing tests** (`packages/pdf/test/secure.test.ts`, wasm loaded via the existing test harness):
  - `secureDocument_then_decryptDocument_roundtrips`.
  - `inspectSecurity_reports_encrypted_aes256`.
  - `decryptDocument_wrong_password_throws_tagged_error` (and the thrown value contains no password).
  - `secureDocument_permissions_round_trip`.
- [ ] **Step 2-4:** FAIL → implement (Rust adapter + TS) → `cargo test -p pdf-core` green; rebuild wasm; `pnpm --filter @magna-carta/pdf test` green; `pnpm check` clean.
- [ ] **Step 5:** commit `feat(pdf): inspect/decrypt/secure bindings + load_protected`.

---

### Task 6: Tools surface — "Unlock & Secure PDF"

**Files:** `packages/access-control/src/registry.ts` (one permission `tools:pdfSecure` + role grants); `packages/tools/src/catalog.ts` (one row); the per-firm role-seed migration (grant the new permission to the same roles as the other document tools — mirror `tools:metadataScrubber`); the SPA Tools shell (`id → component` mapping + the tool component); any all-role seed test union that enumerates permissions.

**Client-side decision (resolve first):** confirm whether `pdf-core` WASM is already loadable in the SPA bundle (check how/if the viewer or another surface loads it). **If yes** → the component calls the `packages/pdf` functions directly; password + bytes never leave the browser; **no worker route, no audit row**. **If not** → either wire the SPA WASM load here (recommended) or add `apps/worker/src/routes/pdf-secure.ts` (mirror `metadata.ts`: chokepoint on `tools:pdfSecure`, `audited:false`, `rateLimit:"expensive"`, base64 in/out, nothing stored) and register in `app.ts` + regenerate the OpenAPI contract. Record the choice in the active-work note.

Catalog row:
```ts
{ id: "pdf-secure", name: "Unlock & Secure PDF", icon: "file-lock-2",
  subjectGroup: "documents", permission: assertPermission("tools:pdfSecure"),
  contextTags: ["file", "none"], backing: { kind: "library" }, matterContext: "none" }
```

UI: drop a file → `inspectSecurity`; if encrypted, prompt + **Unlock**; **Secure** mode sets passwords + permission checkboxes (advisory caveat shown inline) + encrypt-metadata toggle → download. No password is ever sent anywhere it isn't required; nothing is persisted.

- [ ] **Step 1:** add the permission + catalog row + role seed; `vp check` green; the catalog module-load permission assertion passes; access-control + seed tests green.
- [ ] **Step 2:** build the SPA component (design-system components only; Lucide `file-lock-2`; no raw CSS; no emojis). `pnpm check` + svelte-check green.
- [ ] **Step 3:** commit `feat(tools): Unlock & Secure PDF tool (client-side)`.

---

### Task 7: Docs, fragments, status

**Files:** `changelog.d/pdf-secure-encrypt.md`; `docs/decisions/pending/pdf-secure-encrypt.md` (the ADR — adopt lopdf's handler; write AES-256 only; permissions advisory); `packages/pdf/README.md` (the three functions, the not-redaction / advisory-permissions caveats); `docs/user/` (the Tools tool's help page); `STATUS.md` (own row); `ROADMAP.md` (slice 5 complete); the roadmap design's slice-5 line ticked.

- [ ] **Step 1:** write all fragments + docs. No process refs in README/user docs. State plainly: this unlocks with a *known* password (recovery is the separate Decryption tool); permission bits are advisory; secure writes AES-256.
- [ ] **Step 2:** `pnpm check` clean; `vp run worktrees` before editing STATUS/ROADMAP; edit only this slice's STATUS row.
- [ ] **Step 3:** commit `docs(pdf-secure): changelog + ADR + user guide + status`.

---

### Final: package build + review

- [ ] Whole-crate `cargo test` + clippy `--all-targets -D warnings` + fmt; `pnpm check`; `pnpm --filter @magna-carta/pdf test`; rebuild + size-check the wasm against the slice-1 budget.
- [ ] The end-of-build adversarial review (per `docs/conventions/testing.md`) with empirical verifiers, with extra weight on: no password reaches any log/error/console; wrong-password is distinguishable from corrupt; write path is AES-256 (never RC4); a decrypted doc renders and redacts; permission bits round-trip.
- [ ] Fix all findings; then hand to the owner for the merge call.
