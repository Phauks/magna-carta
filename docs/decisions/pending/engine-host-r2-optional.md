---
slug: engine-host-r2-optional
status: Accepted
area: Tools
date: 2026-07-03
summary: Put the engine-host R2 client (reqwest/rustls) behind an off-by-default `r2` cargo feature so an engine container that does not egress to R2 links no HTTP/TLS stack — and therefore no `ring` C/assembly — keeping the default harness pure Rust and honoring golden rule 14 by removing an unused C dependency rather than consenting to it.
---

**The engine-host R2 client is an opt-in `r2` feature; the default harness is pure Rust.**

**Context:** `crates/engine-host` offered `host::r2_client` (a `reqwest` client for R2 GET/PUT)
as a non-optional part of the container hosting toolkit. `reqwest` with the `rustls-tls`
backend pulls `rustls` → `ring`, which contains C and assembly compiled at build time. The
first engine built on the harness — the File Repair recovery container — is stateless: it
receives bytes in the request body and returns results, with no R2 access at all. Yet its
shipped binary linked `ring` transitively through `engine-host`'s unconditional `reqwest`
dependency, for a code path it never calls. That both violated golden rule 14 (a C/C++
dependency, direct or transitive, is used only when there is no memory-safe alternative and
only with explicit owner consent) and made the container's own "pure Rust, no C dependency"
claim false.

**Decision:** make `reqwest` an optional dependency of `engine-host` gated behind a new
`r2` cargo feature, off by default, and gate `host::r2_client` (and its test) on that feature.
An engine that genuinely streams to or from R2 enables `r2` in its `engine_host` dependency and,
at that point, weighs the C/TLS backend (consent to `ring`/`aws-lc-rs`, or a pure-Rust crypto
provider) against golden rule 14 with a concrete need in hand. An engine that holds its bytes in
memory — the common case, and every engine the harness hosts today — links no HTTP/TLS stack and
stays pure Rust. `engine-host` keeps `reqwest` as a plain dev-dependency so its own tests (which
use it only as a loopback HTTP client to drive the axum server) still compile and run regardless
of the feature; a test binary never ships, so the `ring` it pulls reaches no container image.

**Considered and rejected:** consenting to `ring` and documenting it as an accepted transitive
C dependency (rejected — it would consent to memory-unsafe code the container does not use and
would propagate `ring` into every future harness-hosted engine by default, the weakest
memory-safety posture); swapping `reqwest`'s crypto provider to a pure-Rust RustCrypto rustls
provider now (rejected for now — real work and a less battle-tested crypto backend to preserve a
path recovery never exercises; it remains the option to weigh when the first R2-needing engine
arrives).

**Consequences:** the recovery container binary drops `ring`/`rustls`/`reqwest` entirely
(verified: `cargo tree -e no-dev -i ring` is empty), the image is smaller, and its pure-Rust
claim is now true. The harness default is C-free, so the golden-rule-14 question is deferred to
the first engine that actually needs R2 egress, where it can be answered on the merits. This is
the reference posture for engine containers: link the network/TLS stack only when the engine
truly egresses.
