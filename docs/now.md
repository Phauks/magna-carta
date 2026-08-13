# Now

One screen: what is blocked on the owner, what is being built, what is queued, and how much of the
product exists. Every line is derived from the feature ledger in [`roadmap.d/`](../roadmap.d/), so
nothing here can describe a state the ledger does not hold.

**Assembled, never hand-edited.** Run `vp run public-roadmap-build` after changing a ledger node.

What has already shipped is deliberately not repeated here — that is the
[changelog's](../CHANGELOG.md) fact, and a second account of it would be a second thing to keep
current. Slice-by-slice build stages live in [`STATUS.md`](../STATUS.md); the narrative of what each
stream is doing lives in [`ROADMAP.md`](../ROADMAP.md).

## Waiting on you

- **Client-consent model** (ai.md) — Whether client consent for AI is taken once in the engagement letter or per matter. No AI feature reaches a client's data until this is settled.
- **Pronouns on a person** (core-domain.md) — Whether a separate gender field is ever added to a Directory person. It is deliberately not built; pronouns are owner-entered and never inferred.
- **Jurisdiction-configurable compliance engine** (financial.md) — An attorney review of the encoded Nevada trust profile, before any compliance surface is built on top of it.
- **Billing and invoicing** (financial.md) — Whether a credit note draws its own number from the invoice sequence or a sequence of its own.
- **Public changelog/roadmap/status pages** (product-updates.md) — Whether the public changelog and roadmap get a page on the marketing site, and whether that page is indexed by search engines. Both documents are written and rendered; only the page is missing.

## Being built now

- **Matter Files surface** (documents.md) — The matter's documents on real rows — the list, both creation paths (a file, or a template assembly), saving a new version, the version history, and the editing-session launch. The multi-view browser (collection region + capability detail pane) is the next layer over it.
- **File Inspector workbench** (documents.md) — Tools-host of the file surface for inspecting an ephemeral (non-matter) file through the same capability pane.
- **Output placement** (documents.md) — Per-job choice of save-into-matter (versioned R2 sibling, audit-logged) or download a copy.
- **Raster cap & skip gate** (documents.md) — Caps raster size and skips already-text pages in the OCR path.
- **GPU recovery rungs** (documents.md) — GPU-accelerated recovery tiers above the CPU shards.
- **Operating accounting / general ledger** (financial.md) — Extends the ledger to full firm operating books.
- **Docs-maintenance system (docs-sync)** (maintenance-agents.md) — Per-merge deterministic fragment assembly plus a weekly judgment-bearing propose-only routine: draft changelog fragments, flag coverage gaps, roll up ROADMAP, one PR per run.
- **App shell and first surfaces** (platform.md) — Authenticated application shell, navigation, settings surfaces, matter and tools views.
- **Monotonic migration ids** (platform.md) — Collision-proof migration numbering across parallel branches.

## Next up

- **Community and feedback forum** (community.md) — Public, platform-level, cross-firm surface for feature requests with voting, peer discussion, known issues, and roadmap/changelog views; never touches per-firm confidential data.
- **Location on trust accounts** (core-domain.md) — Each trust account associated with a Location; jurisdiction trust-rule profile binds per account.
- **Location as Custodian root** (core-domain.md) — Physical-location hierarchy rooted at a Location (Location, safe, box, position).
- **Carry-forward from a prior matter** (core-domain.md) — Copying selected assets into another matter as new rows with recorded provenance, never a shared row.
- **Retention and destruction dates** (custodian.md) — Retention/destruction dating with the intrinsic-value flag blocking routine destruction of irreplaceable originals.
- **Search** (discovery.md) — Full-text and semantic search over the discovery corpus.
- **Editor UI** (documents.md) — In-app surface that opens a document in the Collabora frame.
- **Video player UI** (documents.md) — Vidstack-based inline player with consistent themed controls; HLS support dormant for future transcoding.
- **Office document conversion** (documents.md) — Documents/spreadsheets/presentations to/from PDF via the server office engine (LibreOffice-class, container-bound).
- **Convert-to menu / converter tool UI** (documents.md) — Data-driven Convert-to menu answered by the registry; file-converter tool surface.
- **Jurisdiction-configurable compliance engine** (financial.md) — A rules profile per state/territory parameterized where states differ (citation, retention, reconciliation cadence, firm-funds allowance, IOLTA model, advance/flat-fee treatment, overdraft reporting, electronic payments, thresholds); rule numbers never hard-coded; Nevada seeded.
- **Multiple active jurisdictions per firm** (financial.md) — Each trust account opened in a state carries its own jurisdiction profile and governing-rule citation and is associated with a Location; matter trust activity defaults from the matter's home location.
- **Email / calendar adapter** (integrations.md) — First planned credentialed vendor port: email filing and calendar sync into matters.
- **PCI scope minimization** (payments.md) — Card capture exclusively via the processor's hosted payment modal returning a cardToken; store token plus last-four/brand only; script-clean payment page; SAQ A.
- **Inbound email capture** (platform.md) — Receiving scan-to-email / inbound mail on Cloudflare via an Email Worker into the ingest pipeline (25 MiB ceiling noted).
- **Channel frontend (Plan 2)** (release-channels.md) — Settings surface for the beta opt-in/consent flow plus stage-labeled Alpha/Beta markers and feedback affordances on pre-stable features, disappearing on graduation.
- **Reports** (reports.md) — Reproducible projections over the append-only ledger; standard library of trust-compliance, financial, productivity, and operational reports with scheduling and exports.

## Where the program stands

| Area | Building Now | Planned | Future | Completed | Not on the roadmap | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Assistance and AI | 5 | 0 | 9 | 12 | 0 | 26 |
| Security and sign-in | 9 | 0 | 8 | 13 | 0 | 30 |
| Calendar and deadlines | 1 | 0 | 7 | 5 | 0 | 13 |
| Communications | 4 | 0 | 14 | 3 | 0 | 21 |
| Community | 0 | 10 | 1 | 0 | 0 | 11 |
| Conflicts | 1 | 0 | 7 | 1 | 0 | 9 |
| Clients, matters and offices | 33 | 3 | 5 | 31 | 0 | 72 |
| Physical custody | 3 | 1 | 2 | 6 | 0 | 12 |
| Design System, UI Consistency & Design Quality | 7 | 0 | 1 | 12 | 0 | 20 |
| Discovery | 10 | 3 | 6 | 4 | 0 | 23 |
| Document automation | 7 | 0 | 1 | 1 | 0 | 9 |
| Documents | 28 | 4 | 22 | 60 | 1 | 115 |
| Time, trust and billing | 24 | 3 | 16 | 15 | 0 | 58 |
| Client intake | 0 | 0 | 7 | 0 | 0 | 7 |
| Integrations and tools | 8 | 1 | 22 | 17 | 0 | 48 |
| Maintenance Agents | 6 | 0 | 6 | 0 | 0 | 12 |
| Notifications | 6 | 0 | 8 | 1 | 0 | 15 |
| Reliability and support | 5 | 0 | 8 | 11 | 0 | 24 |
| Payments | 0 | 1 | 8 | 0 | 0 | 9 |
| Performance & Concurrency | 4 | 0 | 3 | 6 | 0 | 13 |
| Apps and access | 22 | 1 | 28 | 30 | 1 | 82 |
| Client portal | 0 | 0 | 16 | 0 | 0 | 16 |
| Product Updates & User-Facing Documentation | 4 | 0 | 10 | 2 | 0 | 16 |
| Early access | 1 | 1 | 0 | 7 | 0 | 9 |
| Reports | 0 | 9 | 2 | 0 | 0 | 11 |
| Settings & Configuration | 9 | 0 | 4 | 4 | 0 | 17 |
| Tasks and workflows | 0 | 0 | 4 | 0 | 0 | 4 |
| **All areas** | **197** | **37** | **225** | **241** | **2** | **702** |
