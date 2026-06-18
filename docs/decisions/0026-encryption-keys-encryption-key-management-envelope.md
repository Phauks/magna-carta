---
number: 26
slug: encryption-keys-encryption-key-management-envelope
status: Accepted
date:
area: Encryption & keys
---

**Encryption & key management:** envelope encryption with two stored keys — a single **root KEK** (Worker secret, outside D1) wraps a **per-firm key** (stored wrapped in the control-plane firm registry), which **HKDF-derives** purpose keys; enforced structurally by a **`protected()` field type in the firm-scoped DAL** (encrypt-on-write, role-gated + audited decrypt, HMAC **blind index** for Conflicts matching), with the same module handling per-firm plugin credentials. **Encrypt only the narrow secret set** (SSN/DOB/DL/financial IDs, plugin credentials, TOTP); everything else relies on D1/R2 at-rest encryption. **Secrets Store and a separate crypto service both rejected** as unnecessary. **Per-firm crypto-shred** by destroying the wrapped firm key; external-KMS-rooted anchor deferred (Cloudflare has no managed KMS for app data). _Amended 2026-06-12 (slice 1·2 design, ADR-0084): the TOTP open line is closed — seeds stay under **Better Auth's own at-rest encryption** (empirically verified against the pinned version; `encryptionKeys` rotation configured; auth secret in the managed-secrets inventory), not routed through the per-firm chokepoint: they are user-owned auth credentials read at login before firm context exists, and firm crypto-shred must not break a user's login. The concrete envelope/AAD/blind-index layer is ADR-0084._
