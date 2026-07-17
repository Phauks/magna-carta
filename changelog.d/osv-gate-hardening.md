---
category: Security
---

Hardened and consolidated the dependency-audit setup around the osv-scanner CI gate. The gate now pins the osv-scanner binary by SHA256 (verified against the release's published checksum before it runs, failing closed on any mismatch) so a swapped or compromised release asset can't execute. The pre-push git hook's local `pnpm audit` step is removed — it covered only npm, depended on npm's retiring audit endpoint, and duplicated the authoritative CI gate that now audits both the npm and Rust supply chains — and the `package.json` `pnpm.auditConfig` it read is dropped. `osv-scanner.toml` is now the single home for accepted advisories.
