---
category: Security
audience: internal
---

**Eleven of the twenty open advisories across the two supply chains are remediated, and the acceptance
file is empty for the first time.** Nothing had audited them since 2026-08-04: the CI dependency gate is
the only thing that looks, and no runner had been assigned since 2026-08-07. The enumeration was rebuilt
by querying the OSV API directly with the coordinates parsed out of `pnpm-lock.yaml` and all nine
`Cargo.lock` files — the same database and the same lockfile scope the gate's own scanner uses. Its npm
half reproduces GitHub's reported count exactly (four high, five moderate, two low), which is what makes
the rest of the list trustworthy; the nine RustSec findings are additional, and invisible to that count.

What moved, all within an existing major:

- `nanoid` 5.1.11 to 5.1.16 in the catalog — the one **direct production** dependency in the set
  (`packages/identifiers`). Two infinite-loop advisories, and at CVSS 4.0 8.2 the only findings in the
  sweep that were over the audit's fail threshold. Not reachable: the seam imports the secure entry
  point rather than `nanoid/non-secure`, and every size it passes is a compile-time constant.
- `@sveltejs/kit` 2.69.3 to 2.70.2 — quadratic `Accept`-header negotiation. The shipped SPA is
  prerendered by adapter-static and runs no SvelteKit request handler, so the exposed surface was the
  dev server.
- `postcss` 8.5.18 to 8.5.26 in the overrides — an arbitrary `.map` read through a crafted
  `sourceMappingURL`. Taken above its 8.5.23 floor because 8.5.26 is the first release requiring
  `nanoid ^3.3.17`, and that dependency was the only thing holding a vulnerable `nanoid` 3 in the tree.
- `lodash` pinned to 4.18.1 — this retires the long-standing accepted advisory. `postman-collection`
  hard-pins 4.17.21 and never moved, so the acceptance had been sitting on "drops when the carrier
  upgrades" indefinitely; the override is the same move already used for `uuid` on the same carrier, and
  4.18.1 is what every other consumer in the tree already resolved.
- `esbuild` scoped to 0.28.2, and patch bumps of `crossbeam-epoch`, `anyhow` and `memmap2` in the Cargo
  lockfiles.

Nine advisories remain and none is accepted, because an entry in `osv-scanner.toml` is for something
that would otherwise fail the gate and every one of these passes it. Each has either no published fix
(four unmaintained-crate notices, plus `rsa`'s Marvin sidechannel) or no fix reachable without a carrier
moving first (`cookie` behind SvelteKit, `esbuild` 0.18 behind a deprecated `@esbuild-kit`, `lru` behind
tantivy, `wasmtime` behind `yara-x`). The reasoning for each is in the `osv-scanner.toml` header, which
now documents what is deliberately left visible rather than only what is forgiven.
