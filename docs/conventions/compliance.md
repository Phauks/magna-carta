# Compliance conventions — control-to-framework map

**Status:** Active as a map (maintained now); the controls it points to are each active/deferred per their own
home. Formal attestation/certification is **not** an engineering deliverable — see _Two compliance domains_
and [`../research/legal-perimeter.md`](../research/legal-perimeter.md).

**Scope (single home for):** the cross-walk from external compliance frameworks (SOC 2, GDPR / UK GDPR,
PCI DSS, ISO 27001 family) to the Magna Carta controls that satisfy them, plus the **gap register** of controls
not yet decided. This file **maps and links** — it never restates a control (one home per fact); each row cites
the control's real home.

**This is not:**

- **How to build securely** — that is [`security.md`](security.md) (firm-scoping, encryption usage, redaction,
  payment scope). This file says _which framework requirement_ each of those controls answers.
- **The hard rules** — the encryption/secrets and financial invariants live in [`invariants.md`](invariants.md).
- **The attestation/artifact inventory** — the SOC 2 report, DPA, sub-processor list, GDPR statement, BAA, ISO
  certificate, pen-test report, insurance are catalogued in [`../research/legal-perimeter.md`](../research/legal-perimeter.md)
  as an **owner/legal track** (nothing produced yet, by design).

**Authoritative context:** the [white paper](../Magna-Carta-White-Paper.md) — _Tenancy & data isolation_,
_Authentication, access control & encryption_, _Observability & diagnostics_, _Payments_.

## Design to the frameworks now, certify later (ADR-compliance-control-baseline)

The product is pre-distribution with no live clients; certification is deferred to the owner/legal track "when
distribution approaches" (ADR-0090). But the **controls those certifications attest to are built now**, as a
design principle — they are cheap as foundations and expensive to retrofit, and SOC 2 Type II is table stakes
for the enterprise/US firm buyer (legal-perimeter.md). So: every subsystem is built against this map; a new
control checks which framework requirements it can satisfy in one pass; each gap below is tracked to a decision.
GRC-platform adoption (Vanta / Drata / Secureframe — which only _collects_ evidence the controls already
produce) is a later owner call, pending pricing.

**Compliance is not inherited.** Running on Cloudflare (itself SOC 2 / ISO 27001 / ISO 27701 / PCI DSS
attested) covers only the substrate Cloudflare operates. Their reports are evidence for a **sub-service
organization** (carve-out) in our own audit — not a substitute for it. Every control above the platform line is
ours to build and prove. Cloudflare's own reports/DPA are reachable on the Business plan and above (dashboard,
under NDA); a signed Data Processing Addendum rides the self-serve subscription agreement.

## Two compliance domains — kept separate

1. **SaaS-vendor security/data-protection** (this file): SOC 2, GDPR, PCI DSS, ISO 27001 — attestations a firm's
   procurement demands of _us_ as their vendor/processor.
2. **Attorney-ethics / trust-accounting regulatory** ([`../research/trust-rules/`](../research/trust-rules/)):
   IOLTA, state-bar rules, three-way reconciliation — the _firm's_ regulatory obligations the software enforces.
   That is product-domain compliance; it does not belong in this map.

Do not conflate them. The ABA Model Rules / state-bar cloud-vendor **due-diligence** expectation is the bridge:
firms must vet us (confidentiality, data ownership, breach handling, exit/return) — the controls below plus the
legal-perimeter artifacts are what make that due diligence pass.

## Control-to-framework map

What Magna Carta already has, where it lives, and which framework requirement it answers.
**Serves** codes: **S** = SOC 2 (Security/Availability/Confidentiality criteria) · **G** = GDPR/UK GDPR ·
**P** = PCI DSS · **I** = ISO 27001 (+27017/27018/27701).

| Control                                                                                                                                                            | Home                                                                                                             | Status                                                                              | Serves                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| Multi-tenant isolation (firm-scoped data-access layer; per-firm D1 + R2; cross-firm = 404, not 403)                                                                | ADR-0003, ADR-0052, ADR-0068; [`security.md`](security.md)                                                       | Built; fitness-tested (`inference-isolation`, `auth-cookie-isolation`, relay-sweep) | S · G · I                      |
| Encryption at rest — envelope, per-firm keys, `protected()` field, blind index, AES-256/SHA-384, post-quantum agility                                              | ADR-0026, ADR-0046, ADR-0084; [`invariants.md`](invariants.md)                                                   | Built (slice 1·2); ROOT_KEK rotation = seam                                         | S · G · P · I                  |
| Encryption in transit — TLS + Cloudflare hybrid X25519MLKEM768 (verify every hop)                                                                                  | ADR-0046; [`security.md`](security.md)                                                                           | Platform-provided; verify-and-log                                                   | S · G · P · I                  |
| Per-firm crypto-shred — irreversible key destruction (`shredFirmKey`)                                                                                              | ADR-0084; `apps/worker/src/firm-key-shred.ts`                                                                    | Built (function; offboarding route = seam)                                          | G (firm-level erasure) · S · I |
| Access control — trusted-insider RBAC, fixed permission registry, invitation-only auth, deactivation at read path                                                  | ADR-0068, ADR-0073; [`security.md`](security.md)                                                                 | Built; route-conformance fitness function                                           | S · G · I                      |
| Secrets handling — `wrangler secret`, per-firm `getSecret`/`putSecret`, plugins never see key material                                                             | ADR-0026, ADR-0084, ADR-0095; [`operations.md`](operations.md)                                                   | Built; `.dev.vars` byte-identity fitness test                                       | S · I                          |
| Audit logging — control-plane `auth_audit` + per-firm `audit_log`; append-only; decrypt is permission→audit→decrypt, inseparable                                   | ADR-0008 (append-only), ADR-0084; [`invariants.md`](invariants.md)                                               | Storage built + append-only source scan; **viewer/retention/hash-chain deferred**   | S · G · I                      |
| Telemetry redaction — redact-by-default allowlist, correlation-over-content, no third-party error SaaS                                                             | ADR-0017, ADR-0038; [`error-logging.md`](error-logging.md)                                                       | Built; `scrub` / `no-plaintext-escape` / errorId-coverage fitness tests             | S · G · I                      |
| Backup / disaster recovery — D1 Time Travel + per-firm R2 export snapshots, GFS retention, bucket-lock immutability                                                | ADR-0050, ADR-0078                                                                                               | Specified/built; **not certified WORM**; off-Cloudflare cold copy = seam            | S (Availability) · I           |
| Untrusted-file handling — sandboxed Containers, cookieless preview origin, quarantine-on-arrival, malware scan (defense-in-depth)                                  | [`security.md`](security.md); [`../research/upload-malware-scanning.md`](../research/upload-malware-scanning.md) | Rules active; scanner engine deferred                                               | S · I                          |
| Change management / SDLC — branch protection + review, `pnpm check` gate, fitness functions, fragment-based ADR/changelog, 7-angle review, periodic security audit | [`testing.md`](testing.md); root [`CLAUDE.md`](../../CLAUDE.md)                                                  | Active                                                                              | S · I                          |
| Vulnerability / dependency management — `pnpm audit --audit-level high` CI gate + Renovate                                                                         | ROADMAP _Dependency security_                                                                                    | Active; periodic pen-test = owner track                                             | S · I                          |
| Payments / PCI scope — hosted payment modal → SAQ A (see below)                                                                                                    | ADR-0032, ADR-pci-saq-a-hosted-payment-modal; [`security.md`](security.md)                                       | Decided; implementation pending                                                     | P                              |
| Distribution & IP posture — value server-side, client treated as public, no prod source maps                                                                       | ADR-0090; [`security.md`](security.md)                                                                           | Active                                                                              | S · I                          |

## Framework posture & gaps

### SOC 2 (Type II is the target; SOC 3 for public marketing after)

The control substrate above covers the **Security** common criteria plus **Availability** and **Confidentiality**
well. What is missing is not controls but the **attestation machinery**: an auditor engagement, an evidence
window, and (optionally) a GRC platform to collect evidence the controls already emit. Owner/legal track
(legal-perimeter.md _§C_). No report exists yet.

### GDPR / UK GDPR (we are a **processor**; the firm is the controller)

Strong on the technical-measures side: isolation, encryption, crypto-shred, redaction, breach-relevant audit.
**Gaps:**

- **Subject-level erasure / DSAR** — only _firm-level_ crypto-shred exists; per-subject erasure within a firm is
  undecided (ADR-0078 flags per-matter/subject destruction open). → **ADR-subject-level-erasure-dsar** (Accepted; [spec](../specs/2026-07-02-data-subject-attribution-erasure-residency-design.md)) — the PII/erasure registry + fitness-function seam builds now; the erasure orchestrator is deferred.
- **Data residency / international transfers** — no per-firm region control today (Art. 44; also PIPEDA /
  Canadian provincial rules). SCCs/IDTA flow through Cloudflare + the payment processor. → **ADR-data-residency-firm-region-seam** (Accepted; [spec](../specs/2026-07-02-data-subject-attribution-erasure-residency-design.md)) — `firm.data_region` seam + `eu` path; Canada reserved.
- **DPA (Art. 28), published sub-processor list + change notification, GDPR statement, RoPA (Art. 30), breach-
  notification policy (72h to controller), EU representative (Art. 27) / DPO** — owner/legal artifacts,
  unproduced (legal-perimeter.md _§B_).
- **Legal professional privilege** raises the bar: prefer stronger-than-minimum confidentiality; a privileged-
  data breach is uniquely severe.

### PCI DSS v4.0.1 (minimize scope to **SAQ A**)

Card data never touches our surface: capture via Helcim's **hosted payment modal** (iframe), store only the
returned `cardToken` — never the PAN, never the CVV. This holds the firm at **SAQ A** (the smallest
questionnaire). Using Helcim's in-DOM `Helcim.js` instead would be **SAQ A-EP**; the raw card API would be
**SAQ D**. PCI v4.0.1 requirements 6.4.3 (payment-page script inventory) and 11.6.1 (script-integrity
monitoring) now touch even SAQ A, so the payment surface stays **free of third-party scripts**. ACH — the
default rail — and the trust/escrow rails carry no card data and are out of PCI scope. Home:
**ADR-pci-saq-a-hosted-payment-modal**, refining ADR-0032. Enforce with a schema-scan fitness function (no
PAN/CVV column) once payments are built.

### ISO 27001 (+ 27017 cloud, 27018 cloud-PII, 27701 privacy)

~65–75% control overlap with SOC 2, so it is the cheaper second credential for international/enterprise buyers;
pursue **after** SOC 2 once the information-security-management-system maturity exists. 27701 is the structural
home for GDPR as a privacy-information-management system. Owner/legal track; no certificate exists.

## Gap register (net-new decisions)

Each item is either a Proposed ADR (an engineering decision to make) or an owner/legal-track artifact.

| Gap                                                                                                                                                                    | Frameworks | Where it goes                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Subject-level erasure / DSAR (beyond firm crypto-shred)                                                                                                                | G          | **ADR-subject-level-erasure-dsar** (Accepted; [spec](../specs/2026-07-02-data-subject-attribution-erasure-residency-design.md)) — registry+fitness seam building                                                                                                                                          |
| Per-firm data residency / region seam                                                                                                                                  | G, I       | **ADR-data-residency-firm-region-seam** (Accepted; [spec](../specs/2026-07-02-data-subject-attribution-erasure-residency-design.md)) — seam built: `firm.data_region` column + `eu` R2 (bucket + notifications) and firm-database Durable Object jurisdiction placement; DO call-site activation deferred |
| Breach detection → controller-notification workflow + policy                                                                                                           | S, G, I    | Eng seam (incident pipeline exists, ADR-0038) + owner policy (legal-perimeter.md _§B_)                                                                                                                                                                                                                    |
| Audit subsystem — viewer, retention policy, tamper-evidence beyond append-only scan (e.g. hash-chaining)                                                               | S, G, I    | Later slice; storage contract already exists (ADR-0084)                                                                                                                                                                                                                                                   |
| ROOT_KEK rotation machinery                                                                                                                                            | S, I       | Seam reserved in the envelope frame (ADR-0084); scheduled hardening build                                                                                                                                                                                                                                 |
| External-KMS-rooted KEK (root-KEK-compromise = total-compromise mitigation)                                                                                            | S, I       | Deferred hardening (no Cloudflare managed KMS for app data) — white paper _Encryption & key management_                                                                                                                                                                                                   |
| Ethical walls / external-principal (client-portal) enforcement                                                                                                         | S, G       | Named seam (ADR-0068 point 6)                                                                                                                                                                                                                                                                             |
| Attestations & published policies — SOC 2 report, ISO cert, DPA, sub-processor list, GDPR statement, BAA (HIPAA), retention/deletion policy, pen-test, cyber-insurance | S, G, P, I | Owner/legal track — [`../research/legal-perimeter.md`](../research/legal-perimeter.md)                                                                                                                                                                                                                    |

> HIPAA: only if firms handle protected health information (medical-records discovery). Decide early whether to
> **support** it (Business-Associate Agreements with firms _and_ sub-processors — verify Cloudflare BAA
> availability, which is limited) or **contractually exclude** it. Tracked in legal-perimeter.md _§B_.
