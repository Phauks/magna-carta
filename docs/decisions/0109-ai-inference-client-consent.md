---
number: 109
slug: ai-inference-client-consent
status: "Proposed — owner decision pending"
date: 2026-06-19
area: AI / Inference
summary: "Client-consent model for third-party-frontier processing: the recommendation is recorded (yes — but only under ZDR, gated by the firm-level eligibility setting plus a recorded consent decision; strictest firms default to the on-Cloudflare Workers-AI path; privilege must never ride on an implicit default); the choice is not yet made."
---

**Client-consent model for third-party-frontier processing: the recommendation is recorded (yes — but only under ZDR, gated by the firm-level eligibility setting plus a recorded consent decision; strictest firms default to the on-Cloudflare Workers-AI path; privilege must never ride on an implicit default); the choice is not yet made.**

**Context:** ABA Formal Op. 512 / Rule 1.6 make third-party-AI disclosure a confidentiality decision. Whether privileged matter content may go to a third-party frontier model, and under what consent (an engagement-letter blanket consent vs. per-matter consent), is an explicit owner decision — not settled in the design. The foundation (ADR-0110/ADR-0113) pins ZDR + payload-off; this ADR records the open consent question and the recommendation so it is surfaced and decided before the first AI feature ships.

**Recommendation (recorded, not adopted):** yes to third-party-frontier processing, but only under ZDR (procurement artifacts per ADR-0110 obtained), gated by a firm-level "AI processing eligibility" setting (`aiProcessingEligibilityDefinition`, a `FirmSettingDefinition` built now) plus a recorded per-engagement or per-matter consent decision; strictest firms default to the on-Cloudflare Workers-AI path (model-slot selection through the same gateway); per-matter enforcement, consent UI, and the redaction/minimization seam are the first AI feature's scope, not this plumbing slice. Privilege must never ride on an implicit default — the engagement-letter vs. per-matter consent granularity question is the decision to be made.

**Status Proposed — owner must record the chosen consent model as the Accepted form of ADR-0109 before the first AI feature ships.**

Relates to **ADR-0110** (ZDR diligence gate), **ADR-0113** (tenant isolation), **ADR-0111** (Workers-AI path as the strict default). Spec: [`docs/specs/2026-06-17-ai-inference-foundation-design.md`](../specs/2026-06-17-ai-inference-foundation-design.md).
