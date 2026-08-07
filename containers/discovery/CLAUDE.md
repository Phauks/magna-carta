# containers/discovery — local rules

The native Cloudflare-Container HTTP host for the discovery engine. It exposes `discovery-core`
(identify / read / digest / archive enumerate / archive expand) over axum and owns every wire
concern. Built to the pattern `containers/file-repair` established.

- **Its own container, not a route on the search one.** Extraction saturates CPU for hours during a
  bulk load; the search container's whole premise is staying warm with a resident cache serving
  sub-second queries. Sharing them would mean a load makes review search slow — the one combination
  a discovery user actually hits.
- **Pure Rust, memory-safe deps only.** No C/C++ dependency, direct or transitive — the stack is
  axum + tokio + serde + serde_json + base64 over `discovery-core`, all pure Rust. `engine_host` is
  taken WITHOUT its optional `r2` feature: `r2` pulls `reqwest` → `rustls` → `ring` (C/assembly), and
  this service has no R2 egress — it receives bytes and returns facts. Do not enable `r2` here.
  (`ring` still appears in the dev-dependency graph via the loopback test client; a test binary never
  ships.)
- **`enableInternet` is false, and that is load-bearing.** Every byte this container sees is a file an
  opposing party chose, and most of it is privileged. No egress means a parser that is talked into
  making a request cannot make one.
- **The engine stays serde-free and I/O-free.** All HTTP and JSON marshalling lives here; the wire
  DTOs and their string labels are in `src/dto.rs` and nowhere else. Do not add serde or networking
  to `discovery-core`.
- **String labels are fixed and content-free.** Enum-to-string mapping happens only in `src/dto.rs`,
  always as `&'static str` taken from the engine's own vocabulary. An error response carries the
  engine's stable `code` and nothing else — asserted by the 422 test, which checks the body has
  exactly one key.
- **A 422 is a named exception, not a breakage.** `noTextExtracted`, `encrypted`,
  `containerGuardTripped` and the rest are how a document reaches the exception report. Never
  collapse them into a 500: that would turn every honest exception into "the engine broke".
- **`cargo test` runs without Docker.** Tests spawn the full app on an ephemeral loopback port and hit
  it over HTTP — including the panic net (a route that really panics, asserting the service is still
  serving afterwards) and the body cap (composed inside `ready_app`, which is the order the harness's
  default is meant to be overridden in).
- **The image builds in Cloudflare Workers Builds**, not locally, via `image_build_context` set to the
  repo root (see `apps/discovery-worker/wrangler.jsonc`). The Dockerfile copies the whole `crates/`
  workspace, not just the crates it uses: they inherit `edition` from `crates/Cargo.toml`, so cargo
  needs that workspace root or the build fails with `failed to find a workspace root`. The
  `.dockerignore` that trims the context lives at the repo root, not beside the Dockerfile.
- **Validate config changes with**
  `pnpm --filter @magna-carta/discovery-worker exec wrangler deploy --dry-run --containers-rollout=none`,
  which checks the worker bundle and the container config without attempting the image build.
