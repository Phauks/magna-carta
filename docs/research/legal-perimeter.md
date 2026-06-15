# Legal Perimeter — Magna Carta

**Date:** 2026-06-15
**Scope:** The legal, privacy, security-attestation, and IP-protection documents a legal-practice-management SaaS publishes or holds.
**Purpose:** Enumerate the "legal perimeter" named in **ADR-0090** (point 3) so there is a concrete checklist when distribution approaches. This is the **business/legal owner track** — engineering does not build or own these; this doc only catalogs them.

## Method & confidence

Document types were gathered by fetching the public legal/trust pages of the market leaders directly — Clio (the richest trust center) and MyCase — and cross-checking against standard SaaS legal practice. Sources at the end. The list is the _types_ of document, not their contents (owner: "we don't need details, make a list").

**Status of each item:** none are produced yet. This is a forward-looking inventory.

## A. Public-facing agreements & policies

- **Terms of Service / Master Subscription Agreement** — often regional variants (North America / EMEA / AU)
- **Privacy Policy**
- **Cookie Policy**
- **Acceptable Use Policy** — including anti-scraping, anti-benchmarking, and API / rate-limit terms
- **Client Portal Terms** — separate terms for the firm's end-clients using the portal
- **Service Level Agreement** — uptime / availability commitment
- **API / Developer Terms** + developer security & data guidelines
- **Responsible / Vulnerability Disclosure Policy**

## B. Data protection & privacy

- **Data Processing Agreement (DPA)** — controller/processor roles; usually an exhibit to the ToS
- **Sub-processors list** — published, with change-notification
- **GDPR statement** + **Data Subject Requests** process
- **HIPAA stance** + **Business Associate Agreement (BAA)** — more relevant for legal-tech than typical SaaS given health-adjacent matter data
- **Data Breach Notification Policy**
- **Data retention / return / deletion policy** + **Certificates of Destruction**

## C. Security & compliance artifacts (trust center — usually gated under NDA)

Procurement at firms of any size will demand these; **SOC 2 Type II is effectively table stakes** (Clio and MyCase both carry it).

- **SOC 1 Type II** and **SOC 2 Type II** reports
- **ISO 27001** — common, though Clio leans SOC 2 + TX-RAMP
- **TX-RAMP** / other sector certifications
- **Penetration test report** — summary public, full gated
- **CAIQ / security questionnaire self-assessment**
- **Business Continuity Plan** + **Disaster Recovery Plan**
- Supporting internal policies surfaced as evidence: SDLC, change management, access/audit logging, encryption, anti-malware/EDR, BYOD, employee security training, code of conduct
- **Liability / cyber insurance** attestation

## D. IP & brand protection (internal — not documents on a website)

- **Proprietary closed-source license** — the stance (ADR-0088), not a published doc
- **Trademark registration** — name / logo / brand (`magnacarta.esq`)
- **Copyright registration**
- **Trade-secret program** — NDAs and internal-docs handling (the white paper, specs, ADRs, and research are trade secrets)
- **Patents** — case-by-case and disfavored (a patent publishes the method)

## Notes

- **A + B** is what gets published on the site; **C** is what enterprise/firm buyers demand during procurement; **D** is the IP perimeter from ADR-0090 point 3 and lives entirely off-site.
- The security artifacts in **C** are evidence produced _by_ the engineering security posture (security conventions, ADR-0090) but the attestations, audits, and certifications themselves are a compliance/legal exercise.

## Sources

- [Clio Trust Centre](https://trust.clio.com/)
- [Clio Terms of Service](https://www.clio.com/tos/)
- [Clio Privacy Policy](https://www.clio.com/privacy/)
- [Clio GDPR](https://www.clio.com/gdpr/)
- [MyCase Terms of Service](https://www.mycase.com/terms/terms-of-service/)
- [MyCase Privacy Policy](https://www.mycase.com/terms/privacy/)
- [MyCase Client Portal Terms](https://www.mycase.com/terms/client_portal/)
