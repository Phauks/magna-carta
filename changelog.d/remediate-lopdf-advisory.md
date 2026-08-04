---
category: Security
---

Upgraded lopdf to 0.42.0 across every first-party Rust workspace (`crates/` and the `scan`/`ocr`/`recovery`/`file-repair` containers), remediating RUSTSEC-2026-0187 — the stack-overflow denial-of-service in lopdf's PDF parser, on the untrusted-file path. The osv-scanner CI gate's accepted-advisory list drops that entry. The scan container's structural-PDF SIGABRT guards are retained as defense-in-depth. The three remaining tracked advisories (quick-xml x2, npm uuid) stay accepted with corrected, documented reasons: quick-xml is reachable only through office-crypto 0.2.0 (its latest release, which pins quick-xml 0.38, so it cannot be cleared without a newer office-crypto), and the npm uuid advisory is a transitive dev-tooling dependency of postman-collection with no production-runtime exploit path.
