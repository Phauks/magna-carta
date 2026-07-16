---
category: Security
---

CI dependency-audit gate migrated to osv-scanner, now covering the Rust supply chain alongside npm. The gate previously ran npm-only `pnpm audit`; it now runs osv-scanner (v2.4.0) over the npm lockfile and every first-party `Cargo.lock` (`crates/` + `containers/`) against the OSV database (GHSA + RUSTSEC), failing on any HIGH/CRITICAL (CVSS >= 7.0) and failing closed on a scan error. This immediately surfaced four real high-severity advisories the npm-only audit could never see — including a stack-overflow DoS (`RUSTSEC-2026-0187`, lopdf) on the untrusted-PDF-parsing path — now accepted with cause and a time-boxed `ignoreUntil` in `osv-scanner.toml` and tracked for remediation by carrier upgrades. The pre-push hook still runs `pnpm audit` for fast local feedback (migrating it is a follow-up).
