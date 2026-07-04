# containers/file-repair — local rules

The native Cloudflare-Container HTTP host for the file-corruption recovery engine. It exposes
`recovery-core` (diagnose / repair / carve) over axum and owns every wire concern.

- **Pure Rust, memory-safe deps only.** No C/C++ dependency, direct or transitive — the stack is
  axum + tokio + serde + serde_json + base64, all pure Rust. This holds because the `engine_host`
  dependency is taken WITHOUT its optional `r2` feature: `r2` pulls `reqwest` → `rustls` → `ring`
  (C/assembly), which file-repair never needs — it is stateless, with no R2 egress. Do not enable `r2`
  here; if a real R2 need ever arises, weigh the TLS backend under golden rule 14 first. (`ring` still
  appears in the dev-dependency graph via the loopback test client below; a test binary never ships.)
- **The engine stays serde-free and I/O-free.** `recovery-core` is pure compute: bytes in, a model
  value out. This host owns all HTTP and JSON marshalling — the wire DTOs and their string labels
  live in `src/dto.rs`, nowhere else. Do not add serde or networking to `recovery-core`.
- **String labels are fixed and content-free.** Enum-to-string mapping happens only in `src/dto.rs`,
  always as `&'static str`. A label never carries file bytes; error responses carry only the engine's
  stable `code`.
- **`cargo test` runs without Docker.** Tests spawn the full app on an ephemeral loopback port and hit
  it over HTTP — no container runtime required.
- **The image builds in Cloudflare Workers Builds**, not locally, via `image_build_context` set to the
  repo root (see the file-repair-worker `wrangler`). The Dockerfile copies the whole `crates/` workspace
  (not just the two crates it uses): `engine-host`/`recovery-core` inherit `edition` from
  `crates/Cargo.toml`, so cargo needs that workspace root or the build fails. The `.dockerignore` that
  trims the context lives at the repo root (the build-context root — Docker reads it there, not beside
  the Dockerfile). Path deps resolve because the workspace lands at `/src/crates/...` and this host at
  `/src/containers/file-repair`.
- **Reference implementation.** file-repair is the first container built on `engine_host::host`; future
  engine containers copy this shape (thin `main.rs` → `router()` → `engine_host::host` skeleton).
