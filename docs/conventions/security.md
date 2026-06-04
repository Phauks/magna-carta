# Security conventions

**Status:** Stub — to be written alongside auth + the data-access layer (white paper, _Tenancy_ and _Authentication, access control & encryption_; Phase 0).

**Scope (single home for):** the practitioner's how-to for building securely — isolation, access control, encryption usage, secrets handling, telemetry redaction, and payment scope.

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Tenancy & data isolation_; _Authentication, access control & encryption_; _Observability & diagnostics_ (redact-by-default); _Payments_ (PCI SAQ A).

**To document:**

- **Firm-scoping:** every business query goes through the firm-scoped DAL; how the `member` mirror + `firm_id` join works; never cross firms.
- **RBAC + ethical walls:** how to gate an action; how a wall is honored in code. (Note: the access-control model itself is still under-specified — see the white paper's _Authentication, access control & encryption_ `Needs development` note and its forthcoming spec in [`../specs/`](../specs/).)
- **Encryption:** use the DAL `protected()` field type; the envelope-key model; blind-index matching; never hand-roll crypto or store plaintext secrets in core.
- **Secrets:** per-firm plugin credentials via `getSecret`/`putSecret`; plugins never see key material.
- **Telemetry redaction:** allowlist fields; Error IDs and breadcrumbs, never content.
- **Payments/PCI:** hosted-fields tokenization only; keep the firm at SAQ A; fees-never-touch-trust routing.
- Auth hardening: Argon2id, rate limiting, lockout, the immutable auth audit log.

> Firm-scoping and redact-by-default logging are **golden rules** (root [`CLAUDE.md`](../../CLAUDE.md)); `protected()`, secrets-isolation, and the trust/fee rules are **domain invariants** ([`invariants.md`](invariants.md)).

## Untrusted file handling (uploads, processing & preview)

Every uploaded byte (File Manager, Client portal, Discovery ingest) is **untrusted** — Discovery and portal files arrive from external/adversarial parties. Rationale and the full threat model live in the [white paper](../Magna-Carta-White-Paper.md) (_Matters and File Manager_ `Needs development` note); don't restate them here. A malicious file is **inert at rest** (R2 cannot be corrupted/infected) — risk arises only when something **processes, serves, or forwards** it. **Containment is the primary defense; detection (AV) is a thinner layer.** Three threats, in priority order:

- **Server-side RCE (threat #1 — targets _us_).** Native parsers (LibreOffice, FFmpeg, libvips/ImageMagick, ghostscript, qpdf) have a recurring malformed-input RCE class. Run them **only** in **sandbox-hardened Containers**: **no egress** (`enableInternet = false`, or a tight `allowedHosts` allowlist); **least-privilege per job** — the instance gets the single file, never firm-wide R2 creds, D1, or any key (keys never enter the processing path); **ephemeral** (reset per job — no cross-job/cross-firm reuse); **resource caps + timeouts** (a spin/OOM file is contained, not a DoS); **assume-escape**. Where we author the parser, prefer the **Rust→WASM core** (memory-safe sandbox by construction). Home: white paper _Performance & concurrency model_.
- **Stored XSS on preview (threat #3 — targets other users' browsers).** A malicious SVG/HTML/scripted-PDF runs in the viewer's origin. Server sandboxing does **not** help — this is a client-side boundary. Serve untrusted bytes from a **separate, cookieless sandbox origin** (never `app.magnacarta.esq`), with **`Content-Disposition: attachment` + correct `Content-Type` + `X-Content-Type-Options: nosniff`**, a restrictive **CSP**, and **`<iframe sandbox>`** for inline render; **never hand active formats raw to the browser** — preview a **derived safe rendition**. Home: white paper _Inline file preview_.
- **Distribution (threat #2 — targets downstream recipients).** Handing an infected file to a client/co-counsel/court. This is what the **malware scanner** mainly mitigates; with #1/#3 handled structurally it is defense-in-depth + a compliance/cyber-insurance expectation, not the linchpin.

**Scanning rules:** _borrow outside expertise, never outside custody_ — a commercial engine on our own compute is fine; a SaaS that holds privileged bytes (attachmentAV/VirusTotal) is not (same egress bar as in-house conversion/observability). Build the scanner as a **swappable port**; engine deferred. Pipeline: pre-acceptance gates (size/type allow-list, **magic-byte** check, decompression-bomb guards) → **quarantine-on-arrival** (object not servable until cleared; async via R2 event → Queue) → scan (verdict as file metadata) → optional **CDR rendition** (original preserved for evidence) → **re-scan sweep** on signature updates → **quarantine, never auto-delete** (infected files are evidence; destruction blocked by legal holds — the generic "delete-infected" default is wrong here). Files past the engine's scannable cap get an explicit _unscanned_ policy; desktop (Tauri) local pre-scan is the parity accelerator. Tracked in [`../../ROADMAP.md`](../../ROADMAP.md) _Hardening_; its own ADR when built.

## Post-quantum & crypto-agility (ADR-0046)

These rules bind now, ahead of the full security write-up. Rationale and rejected options live in the [white paper](../Magna-Carta-White-Paper.md) (_Encryption and key management_ → _Post-quantum posture_) and **ADR-0046** — don't restate them here.

- **AES-256 everywhere.** All AES (AES-KW key-wrap + AES-GCM payloads) is 256-bit — never AES-128. This is the entire at-rest post-quantum story: symmetric crypto is not broken by quantum (Shor hits public-key; Grover only halves symmetric strength). KDF/HKDF and HMAC hashing use **SHA-384** where a choice exists (CNSA 2.0 margin).
- **Algorithm-versioned ciphertext & signatures.** Every ciphertext, wrapped key, and signature carries an explicit algorithm + version identifier in its envelope, so the scheme can rotate (e.g. to a hybrid ML-KEM wrap or an ML-DSA/SLH-DSA signature) without re-encrypting the corpus. Never emit a bare blob whose algorithm is implied only by the code that happens to read it.
- **Prefer symmetric.** Where a primitive can be symmetric, make it symmetric — session signing is HMAC, the blind index is HMAC. Reach for public-key only where the protocol requires it (TLS, WebAuthn, the PAdES seal).
- **Transport PQC is the platform's job — but verify it.** Cloudflare's hybrid X25519MLKEM768 covers inbound and Worker→origin egress; confirm it is on for every hop (including Containers / service bindings), and **log** any third-party plugin endpoint that won't negotiate PQC TLS (no silent caps — golden rule 10 / ADR-0017).
- **Signatures are deferred, not designed-out.** Passkey/WebAuthn and the e-signature PAdES seal migrate to ML-DSA/SLH-DSA when the upstream standards ship (FIPS 204/205/206, COSE algorithm IDs, ETSI PAdES); keep the e-signature port and certificate handling algorithm-pluggable so adoption is an adapter swap.
- **Never hand-roll PQC.** Use Workers Web Crypto and vetted platform/library implementations; a hybrid ML-KEM wrap or an ML-DSA signature arrives via the platform or a maintained library, never bespoke (golden rule 11 — verify current library docs first).
