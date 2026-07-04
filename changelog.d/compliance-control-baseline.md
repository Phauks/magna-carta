---
category: Added
---

**A compliance control baseline maps the platform's technical controls to SOC 2, GDPR, PCI DSS, and ISO 27001.**
New standard [`docs/conventions/compliance.md`](docs/conventions/compliance.md) cross-walks the existing controls
— tenancy isolation, envelope encryption + crypto-shred, RBAC, redact-by-default telemetry, backup/DR, PCI
SAQ A — to each external framework requirement and registers the open gaps (subject-level erasure/DSAR, data
residency, breach-notification workflow, audit viewer/retention). The controls are engineered now; formal
attestation/certification stays an owner/legal track. Payments are pinned to PCI **SAQ A** via a hosted payment
modal (card data never enters the app). See `ADR-compliance-control-baseline`,
`ADR-pci-saq-a-hosted-payment-modal`, and the Proposed `ADR-subject-level-erasure-dsar` /
`ADR-data-residency-firm-region-seam`.
