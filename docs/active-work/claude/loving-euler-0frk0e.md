---
worktree: (none — this stream runs in the primary checkout)
area: The enforcement surface audits itself — the repo-wide fitness sweep joins the gate, money arithmetic and the Rust lint floor get gates, and the lints acquire a lint of their own
status: building
touches: .github/workflows/gate.yml, package.json, vite.config.ts, pnpm-workspace.yaml, crates/Cargo.toml, tooling/lint-*, docs/conventions/, changelog.d/
---

An audit of what this repository actually enforces found the gaps in two shapes, and this stream
closes both. The first is placement: checks that exist, pass locally, and never run in CI where it
matters — the `@repo-wide-fitness` sweep was defined as half of the repo-wide set and only the other
half was wired into the gate, so the encryption chokepoint scan, the telemetry console ban and the
off-token and bits-ui boundary scans reported for the first time in the merge queue. The second is
absence: rules the repository decided and then left to review — money arithmetic outside
`@magna-carta/money`, a Rust lint floor, Cargo-side license policy, the dead-link and
changelog-coverage checks `documentation.md` already names as missing, and the lints' own coverage
(seventeen of thirty-three could not fail).

Touches the cross-cutting wiring files (`package.json`, `vite.config.ts`, `gate.yml`,
`pnpm-workspace.yaml`) because every new `lint:*` script is derived from the first and every new
Vitest project is registered in the second — coordinate before editing those four.
