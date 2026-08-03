---
category: Added
---

**The platform seal is reachable from the app: `POST /api/v1/documents/seal`.** A firm member with the
new `esign:seal` permission (seeded to Owner/Admin and Attorney) can submit a PDF and receive it sealed
— the PAdES CMS signature embedded, plus the sealed-range digest and a Certificate of Completion. The
route runs through the standard chokepoint (tenancy → authn → RBAC → idempotency → rate-limit) and
forwards to the dedicated `sign-worker` over a `SIGN_SERVICE` service binding through a reusable
`SealPort` adapter, so the signing key never leaves that one worker. The signing time and the observed
signer IP are server-authoritative (never client self-reported); nothing is stored here — only a
redacted `esign.sealed` audit row (digest + signer count + actor, never document content). Until the
sign worker's signing identity is configured the route honestly returns `503`, matching the deferred
activation of the scan, OCR, and conversion engines.
