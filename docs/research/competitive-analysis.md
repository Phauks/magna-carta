# Competitive Feature Gap Analysis — Magna Carta

**Date:** 2026-05-30
**Scope:** Legal practice-management platforms — Clio (Manage + Grow + Draft + Accounting), LEAP, MyCase, Smokeball, CosmoLex, PracticePanther, Rocket Matter, Actionstep, Filevine.
**Purpose:** Catalog notable competitor features, especially ones Magna Carta may be missing, to drive roadmap prioritization.

## Method & confidence

Feature data was gathered by fetching each vendor's public feature / pricing / product pages directly (PowerShell `Invoke-WebRequest`) and parsing them. Sources include clio.com (features, manage, grow, accounting, pricing, payments), leap.us, mycase.com, smokeball.com, cosmolex.com, practicepanther.com, rocketmatter.com, actionstep.com, filevine.com.

Confidence key per cell:

- **Y** = explicitly advertised on the vendor's pages I fetched.
- **(Y)** = strongly implied/named in nav or known product, but the dedicated detail page was 403/404 — treat as "verified by general knowledge + nav listing."
- **?** = unverified (general knowledge only, could not confirm from fetched pages).
- **—** = not advertised / not a feature of that product.
- **Int** = available only through a third-party integration (not native to the product).

Magna Carta's existing coverage (per the brief) is reflected in the final column.

---

## Feature matrix

Columns: Clio | LEAP | MyCase | Smokeball | CosmoLex | PracticePanther (PP) | Rocket Matter (RM) | Actionstep (AS) | Filevine (FV) | **Magna Carta has it?**

| Feature                                            | Clio               | LEAP              | MyCase                   | Smokeball              | CosmoLex                 | PP                        | RM               | AS                              | FV                                    | **Magna Carta?**     |
| -------------------------------------------------- | ------------------ | ----------------- | ------------------------ | ---------------------- | ------------------------ | ------------------------- | ---------------- | ------------------------------- | ------------------------------------- | -------------------- |
| Matter / case management                           | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y                                     | **Yes**              |
| Contact / directory (people + orgs)                | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y                                     | **Yes**              |
| Time tracking (manual + timers)                    | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y                                     | **Yes**              |
| Automatic / passive time capture                   | Y(AI)              | Y                 | ?                        | **Y (AutoTime)**       | ?                        | ?                         | ?                | **Y (AI time capture)**         | ?                                     | **No** (gap)         |
| Trust accounting (multi-jurisdiction)              | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | (Y)                                   | **Yes**              |
| Billing (hourly/flat/contingency/retainer)         | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y                                     | **Yes**              |
| Costs / expenses / disbursements                   | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y                                     | **Yes**              |
| Conflict check                                     | (Y)                | ?                 | ?                        | ?                      | ?                        | ?                         | ?                | **Y**                           | ?                                     | **Yes**              |
| Discovery / e-discovery                            | ?                  | ?                 | ?                        | ?                      | ?                        | ?                         | ?                | ?                               | Y(depo)                               | **Yes**              |
| Document management                                | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y                                     | **Yes**              |
| Document automation / assembly                     | Y(Draft)           | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y(Builder)                      | Y                                     | **Yes**              |
| Court forms library (jurisdiction-specific)        | Y                  | Y(state)          | ?                        | **Y (20k+ forms)**     | ?                        | ?                         | ?                | ?                               | ?                                     | **Partial**          |
| **Document redaction (true content removal)**      | Int (Redactable)   | ?                 | ?                        | ?                      | ?                        | ?                         | ?                | ?                               | ?                                     | **Planned (strength)** |
| Reports / firm insights                            | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y                                     | **Yes**              |
| RBAC / permissions / ethical walls                 | Y                  | ?                 | Y                        | Y                      | Y                        | Y                         | ?                | Y                               | Y(IAM)                                | **Yes**              |
| Email integration (mailbox + matter filing)        | Y                  | Y                 | ?                        | Y                      | Y                        | ?                         | ?                | Y                               | Y                                     | **Yes**              |
| Integrations / API / marketplace                   | Y(300+)            | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y(50+)                          | Y                                     | **Yes**              |
| **— Likely gaps below —**                          |                    |                   |                          |                        |                          |                           |                  |                                 |                                       |                      |
| **Calendaring (in-app legal calendar)**            | Y                  | ?                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | Y(Project Hub)                        | **No (gap)**         |
| **Rules-based court docketing / deadlines**        | Y                  | Y(litig.)         | **Y (LawToolBox)**       | Y                      | ?                        | **Y (LawToolBox)**        | ?                | ?                               | **Y (Timely, 50 states)**             | **No (gap)**         |
| **Two-way calendar sync (Google/Outlook)**         | Y                  | ?                 | **Y**                    | Y(MS)                  | Y(O365)                  | **Y**                     | ?                | Y(O365)                         | Y                                     | **No (gap)**         |
| **Tasks & task management**                        | Y                  | ?                 | Y                        | ?                      | Y                        | Y                         | Y                | Y                               | Y                                     | **No (gap)**         |
| **Workflow automation / matter plans**             | Y                  | ?                 | **Y**                    | **Y**                  | **Y (custom workflows)** | **Y (1-click templates)** | **Y (Legal PM)** | **Y (strong)**                  | Y(phases)                             | **No (gap)**         |
| **Client portal**                                  | Y                  | ?                 | **Y**                    | **Y (Communicate)**    | **Y (secure portal)**    | **Y**                     | ?                | **Y**                           | Y(Case Status)                        | **No (gap)**         |
| **Online payments (trust-compliant, LawPay/etc.)** | Y                  | Y                 | **Y (LawPay)**           | **Y (Smokeball Pmts)** | Y                        | **Y (PantherPayments)**   | Y                | Y                               | **Y (FV Payments)**                   | **No (gap)**         |
| **E-signature**                                    | Y                  | ?                 | **Y (incl., unlimited)** | **Y (DocuSign)**       | Y                        | **Y (native)**            | Y                | ?                               | **Y (Vinesign)**                      | **No (gap)**         |
| **Client intake / CRM / lead pipeline**            | Y(Grow)            | ?                 | **Y (CRM + intake)**     | **Y (Intake)**         | ?                        | **Y (CRM + forms)**       | **Y (CRM)**      | **Y (CRM + intake + webforms)** | **Y (Leads & Intake)**                | **No (gap)**         |
| **Online intake forms / questionnaires**           | Y                  | ?                 | Y                        | Y(FamilyPro)           | ?                        | Y                         | ?                | Y(webforms)                     | Y                                     | **No (gap)**         |
| **Appointment booking / online scheduling**        | **Y**              | ?                 | ?                        | ?                      | ?                        | ?                         | ?                | ?                               | ?                                     | **No (gap)**         |
| **Operating/business accounting (general ledger)** | **Y (Clio Acctg)** | **Y**             | **Y (MyCase Acctg)**     | ? (QBO)                | **Y (built-in)**         | **Y (operating GL)**      | ?                | **Y (multi-currency GL)**       | ?(QBO)                                | **No (gap)**         |
| **Bank reconciliation / 3-way trust recon**        | Y                  | Y                 | **Y (3-way)**            | Y                      | Y                        | Y                         | Y                | Y                               | ?                                     | **Partial**          |
| **LEDES / UTBMS e-billing**                        | **Y**              | ?                 | **Y**                    | **Y**                  | **Y**                    | ?                         | ?                | ?                               | ?                                     | **No (gap)**         |
| **Matter budgeting**                               | **Y**              | ?                 | ?                        | **Y**                  | **Y**                    | **Y**                     | ?                | ?                               | ?                                     | **No (gap)**         |
| **Notes (matter notes)**                           | Y                  | Y                 | Y                        | Y                      | Y                        | Y                         | Y                | Y                               | **Y (Activity Feed)**                 | **Partial?**         |
| **Mobile apps (iOS + Android)**                    | **Y**              | **Y**             | **Y**                    | (Y)                    | **Y**                    | **Y**                     | **Y (native)**   | **Y**                           | (Y)                                   | **No (gap)**         |
| **Client texting / 2-way SMS**                     | **Y (2-way)**      | ?                 | **Y (built-in)**         | ?                      | ?                        | **Y (2-way)**             | ?                | ?                               | Y(texts in feed)                      | **No (gap)**         |
| **Document e-filing to courts**                    | **Y**              | ?                 | ?                        | **Y (InfoTrack)**      | ?                        | ?                         | ?                | ?                               | ?                                     | **No (gap)**         |
| **Knowledge / precedent library**                  | ?                  | ?                 | ?                        | ?                      | **Y (Knowledge Base)**   | ?                         | ?                | **Y (Knowledge Center)**        | Y(Depo Library)                       | **No (gap)**         |
| **Settlement / medical-records mgmt (PI)**         | **Y**              | ?                 | ?                        | ?                      | ?                        | ?                         | ?                | ?                               | **Y (MedChron)**                      | **Partial?**         |
| **Email marketing / website builder**              | **Y (Grow)**       | ?                 | ?                        | ?                      | Y(websites)              | ?                         | Y(websites)      | Y(marketing)                    | ?                                     | **No (likely skip)** |
| **Google Local Services Ads integration**          | **Y**              | —                 | —                        | —                      | —                        | —                         | —                | —                               | —                                     | **No (skip)**        |
| **Collections management**                         | Y                  | ?                 | ?                        | ?                      | ?                        | ?                         | ?                | **Y (Collections)**             | ?                                     | **Partial?**         |
| **AI assistant (case/drafting/analysis)**          | **Y (Manage AI)**  | **Y (Matter AI)** | **Y**                    | **Y (Archie)**         | ?                        | ?                         | ?                | **Y**                           | **Y (LOIS)**                          | **Partial?**         |
| **Court timeline / deposition tooling**            | ?                  | ?                 | ?                        | ?                      | ?                        | ?                         | ?                | ?                               | **Y (Depo CoPilot, court reporting)** | **No (niche)**       |
| **Spend management / firm charge card**            | —                  | —                 | **Y (8am Visa)**         | —                      | —                        | —                         | —                | —                               | —                                     | **No (skip)**        |

---

## Prioritized gap list with recommendations

### MUST-HAVE (table stakes — nearly every competitor has these; absence is a deal-breaker)

1. **Calendaring (in-app legal calendar) + two-way Google/Outlook sync** — _Must-have._ Every competitor ships a native calendar with week/month/timeline views and bi-directional sync. Without it, matters lack a deadline surface and users keep a second tool. Build the calendar entity + CalDAV/Google/Microsoft Graph sync.

2. **Rules-based court docketing / deadline calculation** — _Must-have._ Filevine ("Timely", all 50 states), MyCase + PracticePanther (LawToolBox integration), Clio (Court Rules) all automate statute-of-limitations and court-rule deadline chains. This is the single highest-value litigation differentiator and a malpractice-risk reducer. Either build a rules engine or integrate LawToolBox/InfoTrack.

3. **Tasks & workflow automation / matter plans** — _Must-have._ Universal across the field (Actionstep, Smokeball, CosmoLex, PP, RM, MyCase). Firms expect to attach a templated task/workflow plan to a matter type that auto-creates tasks, events, and documents on triggers. Pairs naturally with our document automation.

4. **Client portal** — _Must-have._ Clio, MyCase, Smokeball, CosmoLex, PP, Actionstep, Filevine all offer a secure client portal (messaging, document exchange, invoice view/pay). Clients now expect it; we already have document mgmt + comms, so this is mostly a secure external-access surface.

5. **Online payments (trust-compliant) + e-signature** — _Must-have._ Click-to-pay links, card/eCheck, retainer-to-trust routing, and native e-signature are universal (LawPay, PantherPayments, Vinesign, DocuSign). We have billing but apparently no payment capture or signing; these directly drive "get paid faster" and remote onboarding. Integrate a LawPay-class processor and an e-sign provider (or DocuSign/Adobe).

6. **Client intake / CRM / lead pipeline + intake forms** — _Must-have._ Clio Grow, MyCase, PP, Actionstep, Filevine, Smokeball all have lead capture → intake form → matter conversion. This is the top-of-funnel that competitors monetize heavily. We have a Directory but no lead/pipeline stage or public intake forms.

7. **Mobile apps (iOS + Android)** — _Must-have._ Every competitor offers native mobile for time capture, document access, and client comms on the go. A responsive web app is a partial stopgap, but native (or PWA) time-capture is expected.

8. **Operating/business accounting (general ledger)** — _Must-have for the "all-in-one" positioning._ CosmoLex, Actionstep (multi-currency GL), PracticePanther, MyCase, LEAP, and Clio Accounting all provide full double-entry operating books, not just trust. We have trust + billing; without a GL, firms still need QuickBooks. We do integrate QuickBooks, so this can be sequenced after the must-haves — but it is a recurring competitor selling point.

### NICE-TO-HAVE (common but not universal; meaningful differentiators)

9. **LEDES / UTBMS e-billing** — _Nice-to-have (must-have if targeting insurance-defense / corporate-counsel firms)._ Clio, MyCase, Smokeball, CosmoLex support LEDES export + UTBMS task codes. Essential for firms billing insurers; skip only if exclusively targeting consumer-facing practice areas.

10. **Automatic / passive time capture** — _Nice-to-have._ Smokeball (AutoTime) and Actionstep (AI time capture) market this as a flagship ROI feature ("bill more with less effort"). Strong differentiator; build on top of our existing timers.

11. **Client texting / 2-way SMS** — _Nice-to-have._ Clio, MyCase, PP, Filevine offer in-app two-way texting logged to the matter. High client-satisfaction value; moderate build (Twilio-class integration into our comms module).

12. **Matter budgeting** — _Nice-to-have._ Clio, Smokeball, CosmoLex, PP expose budget-vs-actual on matters. Pairs with our time/billing; good for fixed-fee and corporate work.

13. **Document e-filing to courts** — _Nice-to-have._ Clio (Court E-Filing) and Smokeball (InfoTrack) file directly with courts. Jurisdiction-dependent and integration-heavy; valuable for litigation-heavy firms. Likely integrate (InfoTrack/One Legal) rather than build.

14. **Knowledge / precedent library** — _Nice-to-have._ CosmoLex (Knowledge Base) and Actionstep (Knowledge Center) centralize internal precedents/policies. Light build; good retention feature.

15. **Appointment booking / online scheduling** — _Nice-to-have._ Clio offers client self-scheduling. Reduces intake friction; could be covered by a Calendly-class integration initially.

16. **3-way trust reconciliation + bank-feed reconciliation UI** — _Nice-to-have / verify._ MyCase markets 3-way trust reconciliation explicitly. We have trust accounting + banking plugin; confirm we expose a guided reconciliation workflow, otherwise close this gap.

17. **AI assistant (case/drafting/analysis)** — _Nice-to-have, rising fast._ Clio (Manage AI), Smokeball (Archie), Filevine (LOIS), LEAP (Matter AI), Actionstep, MyCase all now lead marketing with AI. Increasingly expected; scope an AI layer over our matter/document data (we likely have partial coverage).

### SKIP / LOW-PRIORITY (narrow or off-strategy for a practice-management core)

18. **Email marketing, website builder, Google Local Services Ads** — _Skip (or partner)._ Clio Grow / RM / CosmoLex bundle marketing-site tooling. Off-core for a practice-management platform; revisit only if pursuing a "Grow"-style add-on.

19. **Firm spend management / branded charge card (8am Visa)** — _Skip._ MyCase's fintech play; capital-intensive and far from core.

20. **Deposition / court-reporting / medical-chronology AI (Filevine LOIS, MedChron, Depo CoPilot)** — _Skip for now (niche to mass-tort/PI)._ Deep, PI-specific tooling. Only pursue if targeting personal-injury/mass-tort as a primary vertical (note: we already have e-discovery + safe custody, which partially overlaps).

---

## Notes & caveats

- Cells marked **(Y)** or **?** were inferred from nav menus / general product knowledge because the specific detail page returned 403/404 (e.g., Clio court-rules and calendaring detail pages, some Filevine/Smokeball mobile pages). They should be re-verified before betting roadmap decisions on them.
- Magna Carta's "conflicts check," "e-discovery," and "safe custody" are comparatively rare among these mid-market competitors (Actionstep and Filevine are the closest), so those are existing **strengths**, not gaps.
- **Document redaction (true content removal):** native redaction is essentially absent across the practice-management tier — Clio outsources it to third-party integrations (Redactable, RedactifyAI), and MyCase/Smokeball/Filevine advertise none. Genuine redaction lives in the e-discovery tier (Relativity, Everlaw, Logikcull/DISCO) and Adobe Acrobat / Litera. A correct native implementation is therefore a **differentiator**, adjacent to the e-discovery/safe-custody strengths. Planned approach: PDFium raster-rebuild (render → composite fill region → image-only page), reusing the CDR render Container; MuPDF (AGPL) held as the documented fallback only if searchable text outside redactions must be preserved. The safety guarantee depends on dedicated tests proving no content survives under the fill. (Cells marked **?** are unverified — only the Clio cell was confirmed this pass.)
- Magna Carta's multi-jurisdiction trust accounting + Collabora-based document automation with conditional assembly and PDF forms is at parity-or-better with the field; the gaps are concentrated in **client-facing** (portal, payments, e-sign, intake/CRM, texting), **scheduling/deadlines** (calendar, court rules, sync), **automation** (tasks/workflows), and **back-office accounting** (operating GL, LEDES).
