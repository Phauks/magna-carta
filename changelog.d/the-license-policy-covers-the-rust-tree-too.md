---
category: Security
audience: internal
---

**The license gate reads the Rust supply chain, and its SPDX classifier is now a parser.** `pnpm run lint:licenses` read `pnpm licenses list` and nothing else, so ten Cargo lockfiles — the crates workspace plus every container, 866 crate versions — were vulnerability-scanned by osv-scanner for a year and license-checked by nobody, against a deny-by-default policy whose whole reason is that AGPL or SSPL would force a source offer.

The policy is now one thing in `tooling/license-policy/`, read by two gates: the npm one, unchanged in behaviour, and `pnpm run lint:cargo-licenses`, which discovers every `Cargo.toml` workspace rather than listing them, so a new container joins the gate the day it is added. It runs in the gate's `rust` job, where the toolchain and a warm cargo cache make it a second or two; on the slim runner it would have paid a rustup install and a 163 MB cold fetch for an answer only a lockfile can change.

**Extracting it surfaced a real hole.** The old classifier stripped parentheses and split on the operators, so `(MIT OR GPL-3.0) AND AGPL-3.0` came out **allowed** — it found a permissive disjunct and never saw that the AGPL conjunct binds the whole work. The replacement tokenises and parses the expression at its real precedence (`OR` loosest, then `AND`, then `WITH`), which also stops it denying three forms the Rust tree genuinely carries: `Apache-2.0 WITH LLVM-exception`, the legacy `MIT/Apache-2.0` slash form, and lowercase identifiers. Anything it cannot parse is denied.

The Rust tree is clean: no AGPL, no SSPL, no GPL, no crate without a license. Six permissive identifiers the npm-era list had never met were added with their reasoning — `Unicode-3.0`, `CDLA-Permissive-2.0`, `BSL-1.0`, `MIT-0`, `NCSA`, `zlib-acknowledgement` — and they now bind both ecosystems.
