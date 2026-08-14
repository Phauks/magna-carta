# Now — the build register

Every capability in the program, with its real status, and the arithmetic over the whole set. This
is the complete register rather than a digest: all 705 nodes of the feature ledger in
[`roadmap.d/`](../roadmap.d/) are listed below, at the status the ledger actually holds, with
nothing collapsed and nothing curated away.

**Assembled, never hand-edited.** Run `vp run register-build` after changing a ledger node.

**Where we are, and where we have been.** The ledger records only each capability's current status,
but it is version controlled, so its counts at every past commit are read back in
[Where we have been](#where-we-have-been) below rather than estimated. Two limits hold: a snapshot
shows when a node's **status** changed and never when the work happened, and a capability added to
the ledger late arrives as a jump in the total rather than as work done.
[`CHANGELOG.md`](../CHANGELOG.md) is still the dated record of what shipped and when.
Slice-by-slice build stages live in [`STATUS.md`](../STATUS.md), the narrative of what each stream
is doing lives in [`ROADMAP.md`](../ROADMAP.md), and what each of the nine statuses means lives in
[`roadmap.d/README.md`](../roadmap.d/README.md).

## Where the program stands

**705 capabilities across 27 areas.** Every one of them is listed in [the register](#the-register)
below; these are the totals over that list.

### The roll-up

| Where it stands | Statuses counted | Nodes | Share |
| --- | --- | ---: | ---: |
| Done | shipped | 245 | 35% |
| Part-built | partial, in-build | 203 | 29% |
| Ahead | designed, planned, researching, not-started | 216 | 30% |
| Parked | deferred, cut | 41 | 6% |
| **All capabilities** | | **705** | **100%** |

### Every status

| Status | Nodes | Share |
| --- | ---: | ---: |
| `shipped` | 245 | 35% |
| `partial` | 188 | 27% |
| `in-build` | 15 | 2% |
| `designed` | 21 | 3% |
| `planned` | 10 | 1% |
| `researching` | 8 | 1% |
| `not-started` | 177 | 25% |
| `deferred` | 39 | 6% |
| `cut` | 2 | 0% |
| **All statuses** | **705** | **100%** |

### What `partial` hides

**Shipped alone is 245 of 705 (35%). Shipped plus partial is 433 (61%).**

The 188 nodes between those two numbers are the most decision-relevant fact in this document. A
`partial` capability is most often a backend that works with nothing on screen to reach it, so the
distance from 35% to 61% is approximately the program's interface debt: work that is engineered and
paid for, and that nobody can use. Reading the larger number as how much of the product exists
overstates what a user can do; reading the smaller one understates what has been built. Both are
true and neither is the answer on its own.

### By area

| Area | `shipped` | `partial` | `in-build` | `designed` | `planned` | `researching` | `not-started` | `deferred` | `cut` | Total | Shipped |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AI & Inference | 15 | 5 | 0 | 0 | 0 | 1 | 5 | 3 | 0 | 29 | 52% |
| Authentication, Access Control & Encryption | 13 | 9 | 0 | 0 | 0 | 0 | 5 | 3 | 0 | 30 | 43% |
| Calendar and Rules-Based Docketing | 5 | 1 | 0 | 0 | 0 | 2 | 5 | 0 | 0 | 13 | 38% |
| Communications Layer | 3 | 4 | 0 | 0 | 0 | 0 | 13 | 1 | 0 | 21 | 14% |
| Community & Feedback Forum | 0 | 0 | 0 | 10 | 0 | 0 | 0 | 1 | 0 | 11 | 0% |
| Conflicts Check | 1 | 1 | 0 | 0 | 0 | 1 | 6 | 0 | 0 | 9 | 11% |
| Core Domain — Directory, Matters & Locations | 31 | 33 | 0 | 2 | 1 | 0 | 4 | 1 | 0 | 72 | 43% |
| Custodian (Safe Custody) | 6 | 3 | 0 | 1 | 0 | 0 | 0 | 2 | 0 | 12 | 50% |
| Design System, UI Consistency & Design Quality | 12 | 7 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 20 | 60% |
| Discovery (e-discovery) | 4 | 12 | 0 | 1 | 0 | 0 | 4 | 2 | 0 | 23 | 17% |
| Document Automation | 1 | 7 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 9 | 11% |
| Documents | 60 | 23 | 5 | 2 | 2 | 0 | 19 | 3 | 1 | 115 | 52% |
| Financial Core | 15 | 22 | 4 | 2 | 0 | 0 | 12 | 3 | 0 | 58 | 26% |
| Client Intake / CRM | 0 | 0 | 0 | 0 | 0 | 0 | 7 | 0 | 0 | 7 | 0% |
| Integrations & Plugins | 17 | 8 | 0 | 1 | 0 | 3 | 16 | 3 | 0 | 48 | 35% |
| Maintenance Agents | 0 | 2 | 4 | 0 | 0 | 0 | 6 | 0 | 0 | 12 | 0% |
| Notifications | 1 | 6 | 0 | 0 | 0 | 0 | 4 | 4 | 0 | 15 | 7% |
| Observability & Diagnostics | 11 | 5 | 0 | 0 | 0 | 0 | 6 | 2 | 0 | 24 | 46% |
| Payments | 0 | 0 | 0 | 1 | 0 | 0 | 8 | 0 | 0 | 9 | 0% |
| Performance & Concurrency | 6 | 4 | 0 | 0 | 0 | 0 | 1 | 2 | 0 | 13 | 46% |
| Platform — Delivery, Architecture, Tenancy & Data Conventions | 30 | 20 | 2 | 1 | 0 | 0 | 22 | 6 | 1 | 82 | 37% |
| Client Portal | 0 | 0 | 0 | 0 | 0 | 0 | 15 | 1 | 0 | 16 | 0% |
| Product Updates & User-Facing Documentation | 2 | 4 | 0 | 0 | 0 | 0 | 10 | 0 | 0 | 16 | 13% |
| Release Channels | 7 | 1 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 9 | 78% |
| Reports | 1 | 2 | 0 | 0 | 6 | 0 | 0 | 2 | 0 | 11 | 9% |
| Settings & Configuration | 4 | 9 | 0 | 0 | 0 | 0 | 4 | 0 | 0 | 17 | 24% |
| Tasks and Workflows / Matter Plans | 0 | 0 | 0 | 0 | 0 | 1 | 3 | 0 | 0 | 4 | 0% |
| **All areas** | **245** | **188** | **15** | **21** | **10** | **8** | **177** | **39** | **2** | **705** | **35%** |

## Where we have been

**21 of 40 commits read, 2026-07-14 to 2026-08-14 — 31 days.** The ledger keeps no history of its
own, so this series is reconstructed: for every commit on the trunk that touched
[`roadmap.d/`](../roadmap.d/), the ledger as it stood at that commit is parsed by the same parser
that renders the counts above, and the result is kept in
[`docs/register-history.json`](register-history.json).

### What has moved

**+41 shipped since the ledger began** — 204 on 2026-07-14, 245 on 2026-08-14, across 31 days. The
ledger itself grew by +42 nodes over the same period (663 to 705), so the share shipped went from
31% to 35% against a denominator that was moving too.

That is **9.3 capabilities shipped a week** across the whole series, and **14.0 a week** over the 14
snapshots since the last gap (2026-08-11 to 2026-08-14, +6 shipped in 3 days).

**No completion date is derived from any of this, and none can be.** The ledger puts no size or
effort on a node, so a date extrapolated from these counts would treat a jurisdiction research
corpus and a second authentication factor as the same amount of work. A rate is a rate.

### Every snapshot

| Date | Commit | `shipped` | `partial` | `in-build` | `designed` | `planned` | `researching` | `not-started` | `deferred` | `cut` | Total | Nodes added | Shipped added | Unread before |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 2026-07-14 | `ad6526da` | 204 | 146 | 16 | 32 | 3 | 9 | 212 | 39 | 2 | 663 | — | — | 0 |
| 2026-07-14 | `ccbddcf8` | 204 | 146 | 16 | 32 | 3 | 9 | 212 | 39 | 2 | 663 | 0 | 0 | 0 |
| 2026-08-04 | `31f5b5f7` | 205 | 150 | 16 | 31 | 3 | 8 | 209 | 39 | 2 | 663 | 0 | +1 | 0 |
| 2026-08-04 | `0d72292e` | 205 | 150 | 16 | 35 | 3 | 8 | 205 | 39 | 2 | 663 | 0 | 0 | 0 |
| 2026-08-04 | `ff3676b0` | 206 | 150 | 16 | 35 | 3 | 8 | 205 | 39 | 2 | 664 | +1 | +1 | 0 |
| 2026-08-04 | `3573106d` | 206 | 156 | 16 | 35 | 3 | 8 | 200 | 39 | 2 | 665 | +1 | 0 | 0 |
| 2026-08-04 | `a97e0bf7` | 212 | 158 | 16 | 29 | 3 | 8 | 200 | 39 | 2 | 667 | +2 | +6 | 0 |
| 2026-08-11 | `5902e0aa` | 239 | 181 | 15 | 24 | 4 | 8 | 188 | 39 | 2 | 700 | +33 | +27 | 19 |
| 2026-08-13 | `ee1d92bf` | 241 | 181 | 15 | 24 | 4 | 8 | 188 | 39 | 2 | 702 | +2 | +2 | 0 |
| 2026-08-13 | `7db7f650` | 241 | 181 | 15 | 24 | 13 | 8 | 179 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-13 | `5eaa6752` | 241 | 181 | 15 | 24 | 13 | 8 | 179 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-13 | `3022b4b3` | 241 | 182 | 15 | 24 | 13 | 8 | 178 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-13 | `25fba751` | 241 | 182 | 15 | 24 | 13 | 8 | 178 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-14 | `f30366ad` | 241 | 182 | 15 | 24 | 13 | 8 | 178 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-14 | `0a1860c0` | 241 | 182 | 15 | 24 | 13 | 8 | 178 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-14 | `3c764ff0` | 241 | 184 | 15 | 22 | 13 | 8 | 178 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-14 | `bb884fdc` | 241 | 184 | 15 | 22 | 13 | 8 | 178 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-14 | `4feb0ed5` | 241 | 186 | 15 | 21 | 13 | 8 | 177 | 39 | 2 | 702 | 0 | 0 | 0 |
| 2026-08-14 | `c692886a` | 244 | 186 | 15 | 21 | 13 | 8 | 177 | 39 | 2 | 705 | +3 | +3 | 0 |
| 2026-08-14 | `eb1129f2` | 244 | 186 | 15 | 21 | 13 | 8 | 177 | 39 | 2 | 705 | 0 | 0 | 0 |
| 2026-08-14 | `5ae1ca20` | 245 | 188 | 15 | 21 | 10 | 8 | 177 | 39 | 2 | 705 | 0 | +1 | 0 |

### The gaps

**19 of the 40 commits do not parse under today's ledger schema** — they run from 2026-08-04 to
2026-08-11, and every one of them fails for the same reason. They are recorded as holes: their
counts are absent from the table above, no line is drawn through them, and the changes on either
side of a hole are stated across it rather than apportioned to it. Re-run the reconstruction with
`--rebuild` after a parser change to pick up any that have since become readable.

**19 commits, 2026-08-04 to 2026-08-11** — roadmap.d/document-automation.md: line 14:
"document-automation.conditional-assembly" has unknown status "built" (expected one of shipped,
partial, in-build, designed, planned, researching, not-started, deferred, cut)

`a98c78df` (2026-08-04), `a0130bbf` (2026-08-04), `f03fb4d5` (2026-08-05), `6f422b1d` (2026-08-05),
`18c23915` (2026-08-05), `57a0b679` (2026-08-05), `7bee0801` (2026-08-05), `324664c9` (2026-08-05),
`0377a9b9` (2026-08-05), `8fd3ea9a` (2026-08-06), `e8837e3f` (2026-08-06), `227b4acd` (2026-08-06),
`45003814` (2026-08-07), `93eee6c5` (2026-08-07), `846dbd4e` (2026-08-07), `681f4b98` (2026-08-10),
`953e9a0c` (2026-08-11), `bafaf62d` (2026-08-11), `c164cc0c` (2026-08-11)

### Movement by area

| Area | Nodes then | Nodes now | Shipped then | Shipped now | Shipped added |
| --- | ---: | ---: | ---: | ---: | ---: |
| AI & Inference | 17 | 29 | 8 | 15 | +7 |
| Authentication, Access Control & Encryption | 30 | 30 | 13 | 13 | 0 |
| Calendar and Rules-Based Docketing | 8 | 13 | 0 | 5 | +5 |
| Communications Layer | 19 | 21 | 2 | 3 | +1 |
| Community & Feedback Forum | 11 | 11 | 0 | 0 | 0 |
| Conflicts Check | 9 | 9 | 1 | 1 | 0 |
| Core Domain — Directory, Matters & Locations | 58 | 72 | 21 | 31 | +10 |
| Custodian (Safe Custody) | 10 | 12 | 0 | 6 | +6 |
| Design System, UI Consistency & Design Quality | 20 | 20 | 12 | 12 | 0 |
| Discovery (e-discovery) | 20 | 23 | 3 | 4 | +1 |
| Document Automation | 8 | 9 | 0 | 1 | +1 |
| Documents | 115 | 115 | 59 | 60 | +1 |
| Financial Core | 55 | 58 | 8 | 15 | +7 |
| Client Intake / CRM | 7 | 7 | 0 | 0 | 0 |
| Integrations & Plugins | 48 | 48 | 17 | 17 | 0 |
| Maintenance Agents | 12 | 12 | 0 | 0 | 0 |
| Notifications | 15 | 15 | 0 | 1 | +1 |
| Observability & Diagnostics | 24 | 24 | 11 | 11 | 0 |
| Payments | 9 | 9 | 0 | 0 | 0 |
| Performance & Concurrency | 13 | 13 | 6 | 6 | 0 |
| Platform — Delivery, Architecture, Tenancy & Data Conventions | 82 | 82 | 30 | 30 | 0 |
| Client Portal | 16 | 16 | 0 | 0 | 0 |
| Product Updates & User-Facing Documentation | 16 | 16 | 2 | 2 | 0 |
| Release Channels | 9 | 9 | 7 | 7 | 0 |
| Reports | 11 | 11 | 0 | 1 | +1 |
| Settings & Configuration | 17 | 17 | 4 | 4 | 0 |
| Tasks and Workflows / Matter Plans | 4 | 4 | 0 | 0 | 0 |

**Fastest since the first snapshot:** Core Domain — Directory, Matters & Locations (+10), AI &
Inference (+7), Financial Core (+7). **16 of 27 areas have shipped nothing in that time**:
Authentication, Access Control & Encryption, Community & Feedback Forum, Conflicts Check, Design
System, UI Consistency & Design Quality, Client Intake / CRM, Integrations & Plugins, Maintenance
Agents, Observability & Diagnostics, Payments, Performance & Concurrency, Platform — Delivery,
Architecture, Tenancy & Data Conventions, Client Portal, Product Updates & User-Facing
Documentation, Release Channels, Settings & Configuration, Tasks and Workflows / Matter Plans. An
area standing still here has not necessarily been idle — a node moves in this table only when it
reaches `shipped`, so work that went from nothing to `partial` shows up in the nodes columns and not
in this one.

## Waiting on you

- **Embedding pin held open until the first index** (`ai.inference.embedding-pin-window`) — Which embedding model the first index is built with. The pin is unchangeable once vectors exist, so this is decided before the first one is written, not after.
- **Client-consent model** (`ai.consent`) — Whether client consent for AI is taken once in the engagement letter or per matter. No AI feature reaches a client's data until this is settled.
- **Feedback board** (`community.board`) — Two calls, both on the open pull request. Whether to ratify a named exception to the firm-scoped data rule, since a shared board is cross-firm by definition; and how a signed-in member's session reaches the community host, which is a different origin from the application.
- **Pronouns on a person** (`directory.pronouns`) — Whether a separate gender field is ever added to a Directory person. It is deliberately not built; pronouns are owner-entered and never inferred.
- **Search** (`discovery.search`) — Six settings, all reasoned rather than measured, because nothing in the repository can price them until the search container runs against a real corpus. The container's instance size is a guess that mirrors the malware scanner, whose working set is one file where search's is however many splits a firm keeps open — and whether a split cache earns its authorization complexity is the same unmeasured question. Then the four from compaction: the merge thresholds, how long a superseded index object is kept before retirement, whether the search worker gains a compaction endpoint, and ratification of the changed query input shape.
- **Trust accounting** (`financial.trust`) — Three controls are analysed and deliberately not built. Whether one person may relax the two-person release control and then act alone; whether matter-to-matter reallocations, which move no money out of trust, stay outside the authorization policy; and whether to close the structuring gap where two at-threshold requests pass where one larger request would not.
- **Jurisdiction-configurable compliance engine** (`financial.trust.jurisdiction-engine`) — An attorney review of the encoded Nevada trust profile, before any compliance surface is built on top of it.
- **Billing and invoicing** (`financial.billing`) — Whether a credit note draws its own number from the invoice sequence or a sequence of its own.
- **Public changelog/roadmap/status pages** (`product-updates.public-pages`) — Whether the public changelog and roadmap get a page on the marketing site, and whether that page is indexed by search engines. Both documents are written and rendered; only the page is missing.
- **Trust-compliance reports** (`reports.trust-compliance`) — What a pack does when no jurisdiction rule can be cited, which is every pack today because every encoded jurisdiction ships unreviewed and no corpus is bound. It currently states that on the cover in the corpus's own words and produces the rest; refusing outright is the alternative, and would mean the surface produces nothing at all until an attorney review lands. Three defaults ship behind seams beside it and none is settled: whether a pack names the person who authorized each disbursement, whether zero-balance client ledgers appear, and whether the frozen attestation or the live proof leads each reconciliation.

Decisions about a capability only. Account-side steps that no session can perform — a Cloudflare dashboard action, a billing budget, a repository setting — are listed in [`docs/deploy-queue.md`](deploy-queue.md), which is their one home.

## Being built now

- `documents.file-manager.matter-files-ui` · **Matter Files surface** — The matter's documents on real rows — the list, both creation paths (a file, or a template assembly), saving a new version, the version history, and the editing-session launch. The multi-view browser (collection region + capability detail pane) is the next layer over it.
- `documents.file-manager.file-inspector` · **File Inspector workbench** — Tools-host of the file surface for inspecting an ephemeral (non-matter) file through the same capability pane.
- `documents.conversion.output-placement` · **Output placement** — Per-job choice of save-into-matter (versioned R2 sibling, audit-logged) or download a copy.
- `documents.ocr.raster-cap` · **Raster cap & skip gate** — Caps raster size and skips already-text pages in the OCR path.
- `documents.decryption.gpu` · **GPU recovery rungs** — GPU-accelerated recovery tiers above the CPU shards.
- `financial.ledger.operating-gl` · **Operating accounting / general ledger** — Extends the ledger to full firm operating books.
- `financial.ledger.operating-gl.chart-of-accounts` · **Chart of accounts** — The product chart-of-accounts the baseline schema defers, with the firm account resolver invoicing needs.
- `financial.ledger.operating-gl.accounts-payable` · **Accounts payable** — Accounts payable as a subledger of the operating books.
- `financial.ledger.operating-gl.financial-statements` · **Financial statements** — Trial balance, balance sheet, and income statement read primitives over the operating books.
- `maintenance-agents.docs-maintenance` · **Docs-maintenance system (docs-sync)** — Per-merge deterministic fragment assembly plus a weekly judgment-bearing propose-only routine: draft changelog fragments, flag coverage gaps, roll up ROADMAP, one PR per run.
- `maintenance-agents.docs-maintenance.per-merge-assembly` · **Per-merge fragment assembly workflow** — CI workflow on every push to main folding changelog.d/, docs/decisions/pending/, and status.d/ into the rendered trackers.
- `maintenance-agents.docs-maintenance.weekly-routine` · **Weekly docs-sync routine** — Scheduled fresh-session routine executing .claude/skills/docs-sync/SKILL.md; audits the merge window, opens one docs-sync PR.
- `maintenance-agents.docs-maintenance.run-reports` · **Run-report registry** — One append-only report per run under docs/maintenance/reports/ carrying machine-readable window state.
- `platform.web-spa.app-shell` · **App shell and first surfaces** — Authenticated application shell, navigation, settings surfaces, matter and tools views.
- `platform.schema-migration.monotonic-ids` · **Monotonic migration ids** — Collision-proof migration numbering across parallel branches.

## Next up

- `community` · **Community and feedback forum** — Public, platform-level, cross-firm surface for feature requests with voting, peer discussion, known issues, and roadmap/changelog views; never touches per-firm confidential data.
- `community.board` · **Feedback board** — Feature requests with popularity-ranked upvotes, comments, tags, status pipeline, and roadmap-as-filtered-view-by-status.
- `community.package` · **Extractable community package** — Clean @magna-carta/community package, platform-level and isolated from the per-firm data-access layer.
- `community.confidentiality` · **Confidentiality boundary** — Posting always opt-in and user-authored; nothing flows automatically from private matters or the private bug pipeline into the public forum.
- `community.identity` · **Display-name identity and SSO** — Better Auth SSO with display-name-only public identity; real name/firm never shown; aggregate vote counts only.
- `community.escalation-bridge` · **Private-report escalation bridge** — One-way, user-opted escalation of a private diagnostic report into a public feature request or known-issue check.
- `community.known-issues` · **Known-issues view** — Public known-issues view mirroring the live status content.
- `community.changelog-sync` · **Shipped-items changelog sync** — Requests marked shipped sync to the changelog; popular requests inform the roadmap.
- `community.agent-status-posts` · **Agent status posts** — Maintenance/diagnostics agents post public status on known issues, propose-only, never exposing privileged detail.
- `community.moderation` · **Moderation and abuse handling** — Permanent moderation, spam/abuse, and security operation of a public board, owned in-house.
- `locations.usage.trust-accounts` · **Location on trust accounts** — Each trust account associated with a Location; jurisdiction trust-rule profile binds per account.
- `locations.usage.custodian` · **Location as Custodian root** — Physical-location hierarchy rooted at a Location (Location, safe, box, position).
- `matter-assets.carry-forward` · **Carry-forward from a prior matter** — Copying selected assets into another matter as new rows with recorded provenance, never a shared row.
- `custodian.retention-destruction` · **Retention and destruction dates** — Retention/destruction dating with the intrinsic-value flag blocking routine destruction of irreplaceable originals.
- `discovery.search.semantic` · **Semantic search** — Vectorize-backed semantic search alongside keyword search.
- `documents.editing.editor-ui` · **Editor UI** — In-app surface that opens a document in the Collabora frame.
- `documents.preview.player` · **Video player UI** — Vidstack-based inline player with consistent themed controls; HLS support dormant for future transcoding.
- `documents.conversion.office` · **Office document conversion** — Documents/spreadsheets/presentations to/from PDF via the server office engine (LibreOffice-class, container-bound).
- `documents.conversion.convert-ui` · **Convert-to menu / converter tool UI** — Data-driven Convert-to menu answered by the registry; file-converter tool surface.
- `financial.trust.jurisdiction-engine.rules-catalog` · **Trust-rules catalog (56 jurisdictions)** — Verified research corpus of 56 US jurisdictions across 16 rule dimensions compiled into shared reference data.
- `financial.trust.multi-jurisdiction-accounts` · **Multiple active jurisdictions per firm** — Each trust account opened in a state carries its own jurisdiction profile and governing-rule citation and is associated with a Location; matter trust activity defaults from the matter's home location.
- `integrations.ports.email-calendar` · **Email / calendar adapter** — First planned credentialed vendor port: email filing and calendar sync into matters.
- `payments.pci-scope` · **PCI scope minimization** — Card capture exclusively via the processor's hosted payment modal returning a cardToken; store token plus last-four/brand only; script-clean payment page; SAQ A.
- `platform.scan-capture.inbound-email` · **Inbound email capture** — Receiving scan-to-email / inbound mail on Cloudflare via an Email Worker into the ingest pipeline (25 MiB ceiling noted).
- `release-channels.frontend` · **Channel frontend (Plan 2)** — Settings surface for the beta opt-in/consent flow plus stage-labeled Alpha/Beta markers and feedback affordances on pre-stable features, disappearing on graduation.
- `reports.financial` · **Financial reports** — WIP, A/R aging, realization, and profitability reports.
- `reports.productivity` · **Productivity reports** — Timekeeper and staff productivity reporting.
- `reports.operational` · **Operational reports** — Operational reporting over firm activity.
- `reports.location-rollups` · **Per-location roll-ups** — Financial and productivity reports filter and subtotal by office; trust reports inherently per-account/per-location.
- `reports.scheduling` · **Scheduled generation** — Scheduled/automated report generation, archival, and optional email delivery.
- `reports.exports` · **Exports** — PDF, Excel/CSV, and print export of reports.

## The register

Every node in the ledger, by area, in the order the area file writes them.
Indentation follows the dotted id, so a child sits under its parent and a parent's status is a
roll-up of what is beneath it. Nothing is collapsed, nothing is summarised, and nothing is left out:
to change a line here, edit the node in its area file and re-run the build.

### AI & Inference

[`roadmap.d/ai.md`](../roadmap.d/ai.md) — 29 nodes, 52% shipped. 15 done, 5 part-built, 6 ahead, 3 parked.

- `ai` · `partial` · **AI / inference** — Single credential-less model chokepoint owning confidentiality, tenant isolation, and fairness; AI-text detection; consent gate before any feature sends privileged content to a model.
  - `ai.inference` · `shipped` · **Inference chokepoint (@magna-carta/inference)** — Every AI feature reaches the model through one pure package; no feature talks to the gateway directly.
    - `ai.inference.port` · `shipped` · **InferencePort operations** — Streaming and durable/Workflow-invocable text generation plus a platform-fixed embedding operation; reasoning model an explicit per-call parameter, embedding model pinned to the Vectorize index.
    - `ai.inference.embedding-pin-window` · `shipped` · **Embedding pin held open until the first index** — The embedding model is changeable only while no vector index exists, because every stored vector is a function of the model that produced it. The catalog records that state and a fitness scan refuses to let the window close by accident — while the pin reads open, no source file may reach a vector index.
    - `ai.inference.model-catalog` · `shipped` · **Curated ZDR-only model catalog** — In-repo data table of allowed models; every reasoning entry zdrEligible, zod-validated at module load; non-ZDR models unrepresentable. Each entry also records the provider's published lifecycle facts (retirement date, successor) under a verification date separate from the confidentiality one, and the FORM the provider publishes its pinned snapshot in, so a snapshot id that contradicts its own form fails at import rather than reaching a provenance record.
    - `ai.inference.reasoning-tier` · `shipped` · **Evergreen reasoning tier** — A platform-maintained tier name (most-capable / balanced) that the firm default and deploy configuration resolve through, so tracking model advancement is a data edit rather than a code change. An override can only ever select a model already curated in the catalog, so non-ZDR models stay unrepresentable. _Note: Which model occupies each tier is unchanged from what the platform already ran; moving a tier onto a published successor is an open owner decision._
    - `ai.inference.pin-freshness` · `shipped` · **Model-pin staleness detection** — A pure pass over the catalog that reports a pin past its published retirement, approaching one, superseded by a newer generation, or overdue for re-verification. Expiry fails the gate; the rest is reported. Cannot detect a successor released since the last check — that gap is bounded by the re-read interval, not closed.
    - `ai.inference.firm-model-selection` · `shipped` · **Per-firm reasoning-model selection** — Firm's primary reasoning model in the per-firm setting table; schema refined over the ZDR-eligible subset; total reads with safe default derived from the platform tier rather than a literal model id.
    - `ai.inference.confidentiality` · `shipped` · **Confidentiality control plane** — Gateway-level ZDR, collectLog false and skipCache true pinned per request, fail-closed pre-dispatch ZDR guard that rejects rather than downgrades. _Note: Cloudflare/Anthropic ZDR procurement artifacts gate the first real AI feature, not this layer._
    - `ai.inference.tenant-isolation` · `shipped` · **Tenant isolation & metering** — Firm metadata derived server-side (never caller-supplied); authoritative per-request token usage written through the firm-scoped data-access layer as the reconcilable metering record.
    - `ai.inference.fairness` · `partial` · **Multi-tenant fairness** — One shared gateway per environment; queue-dispatched inference off the hot path; firm-scoped spend rule and account credit alarm as real-time guardrails.
    - `ai.inference.byok` · `deferred` · **BYOK credentialed adapter** — Per-firm bring-your-own-key adapter using the integration ConnectionStore/CredentialStore lifecycle; Unified-Billing-to-BYOK crossover as config.
  - `ai.consent` · `researching` · **Client-consent model** — Owner decision on whether privileged matter content may reach third-party frontier models and under what consent; required before the first AI feature ships.
  - `ai.text-detection` · `partial` · **AI-text detection** — Vendor-agnostic detection core (signal-not-proof, LikelihoodBand) with pluggable vendor adapters and per-firm consent.
    - `ai.text-detection.core` · `shipped` · **Detection core** — Vendor-agnostic model: likelihood bands, never a verdict.
    - `ai.text-detection.pangram-adapter` · `shipped` · **Pangram vendor adapter** — Platform-managed adapter (one platform key, credential none), per-firm consent setting enforced at the chokepoint, paste-text endpoint, per-firm usage metering.
    - `ai.text-detection.ui` · `not-started` · **Detection UI** — In-app surface for running and reading detections.
    - `ai.text-detection.extensions` · `deferred` · **Detection extensions** — BYO-key, billing pass-through, document text-extraction input, bulk endpoint, matter-action integration.
  - `ai.first-feature` · `partial` · **First concrete AI feature** — Drafting / retrieval-augmented assistance / discovery AI review — the named consumer owning its spec, consent UI, and per-matter enforcement.
  - `ai.magnus` · `partial` · **Magnus — the conversational assistant** — The assistant a firm member talks to — the conversation and turn record, two fail-closed consent gates, the queue-dispatched path to an answer through the one inference chokepoint, and the poll-and-push transport.
    - `ai.magnus.record` · `shipped` · **Transcript as firm work product** — Conversations and turns in per-firm D1 through the firm-scoped data-access layer — protected, deletable, archivable. Author-and-administrator visible, never client-visible, member-deletable with the deletion audited and registered in the erasure registry. Discoverable like email, so any search or collection surface reaching transcripts must carry an explicit include-or-exclude control.
    - `ai.magnus.consent` · `shipped` · **Two fail-closed consent gates** — The firm's general AI-processing setting plus a feature-specific one, both default closed, read in one resolver, re-read by the consumer before the model call so a gate closing stops queued work.
    - `ai.magnus.port-reuse` · `shipped` · **One model port, one additive operation** — No second model port — the assistant consumes the shipped InferencePort and adds generateConversation, with a platform-vocabulary role set and a structurally separate system prompt.
    - `ai.magnus.stub-adapter` · `shipped` · **Deterministic stub InferencePort** — A complete, network-free implementation of the port that every AI feature inherits; the composition root resolves to it whenever the binding or the enabling configuration is absent.
    - `ai.magnus.streaming` · `not-started` · **Token streaming** — Delta frames on the push-progress protocol, a protocol version bump, and partial-content semantics for a stream that dies mid-answer.
    - `ai.magnus.interface` · `not-started` · **Assistant interface** — The in-app chat surface, the firm-administrator enablement screen, and the member disclosure.
    - `ai.magnus.context` · `not-started` · **Explicit per-conversation context grants** — What the assistant can see beyond what the member typed. The shape is settled — the member attaches a named document or matter and can see exactly what was attached; implicit firm-wide retrieval is not on this path and would need a consent decision of its own.
    - `ai.magnus.actions` · `deferred` · **Tools and actions** — Propose-and-approve only, where a tool proposes, a member approves, and the approval is the audited act.
  - `ai.consumer-seams` · `not-started` · **Downstream consumer seams** — Document automation generation, discovery semantic search / RAG over Vectorize, and search query expansion referencing the inference chokepoint.

### Authentication, Access Control & Encryption

[`roadmap.d/auth.md`](../roadmap.d/auth.md) — 30 nodes, 43% shipped. 13 done, 9 part-built, 5 ahead, 3 parked.

- `auth` · `partial` · **Authentication, access control and encryption** — First-party Better Auth login, trusted-insider RBAC, and narrowly-scoped structural application-level encryption.
  - `auth.first-party-login` · `shipped` · **First-party login** — Better Auth on control-plane D1 (Drizzle adapter), firm = organization, exactly one organization per user; role/profile mirrored to the per-firm member row. _Note: API-only to date; the login/2FA UI is the 0-7b slice (branch active)._
    - `auth.first-party-login.invitation-only` · `shipped` · **Invitation-only membership** — Nobody adds themselves to an existing firm; Better Auth's own signup stays structurally off, and joining a firm goes through invitation redemption with an email-verified flip. _Note: Founding a NEW firm is now self-serve (ADR-0280) — that is the one anonymous write, two-staged behind an emailed link. Membership of an existing firm remains invitation-only, which is what this node covers._
    - `auth.first-party-login.auth-ui` · `partial` · **Login and 2FA UI** — The login/2FA surface over the auth backend — the design system's first consumer. _Note: Sign-in shipped. Registration and invitation-redemption screens are not built (their routes are), nor are the two-factor enrolment screens; passkeys, the one-time sign-in link, firm identity providers, workspace selection, the second-factor channel choice and Turnstile remain server-side gaps._
  - `auth.two-factor` · `partial` · **Second factors** — Passkeys/WebAuthn and TOTP primary; email codes and SMS secondary/recovery only.
    - `auth.two-factor.totp` · `shipped` · **TOTP** — TOTP enrollment and login with transition-exact audit events.
    - `auth.two-factor.passkeys` · `not-started` · **Passkeys / WebAuthn** — Passkey server plugin, enrollment UI, virtual-authenticator test coverage. _Note: Deferred from the auth backend slice because WebAuthn needs a browser; scheduled into the auth-UI slice._
    - `auth.two-factor.email-otp` · `not-started` · **Email OTP** — Email codes as a secondary/recovery factor.
    - `auth.two-factor.sms-otp` · `not-started` · **SMS OTP** — Better-Auth-generated codes delivered through the Communications layer messaging port; flagged weakest, never a sole second factor. _Note: Messaging port decision accepted; no delivery adapter built._
  - `auth.hardening` · `partial` · **Auth hardening** — Argon2id hashing, secure sessions, rate limiting, account lockout, email verification, password reset, immutable auth audit log.
    - `auth.hardening.auth-audit-log` · `shipped` · **Auth audit log** — Immutable control-plane auth audit (login success, 2FA transitions, password reset, key shred, alpha-door writes).
    - `auth.hardening.rate-limiting` · `partial` · **Rate limiting** — Rate limiting on the API surface via the chokepoint's declared limits. _Note: Seam built into the chokepoint; a production limiter backend is not verified in the tree._
  - `auth.access-control` · `partial` · **Trusted-insider access control** — Firm isolation the only hard boundary; RBAC governs actions not visibility; ethical walls a future content overlay.
    - `auth.access-control.permission-registry` · `shipped` · **Permission registry** — Fixed platform registry, one namespace per subsystem (subsystem:action); every route declares one, cross-checked by a fitness function.
    - `auth.access-control.roles-as-data` · `shipped` · **Roles as data** — role-to-permissions and member-to-roles rows seeded with editable defaults; effective permissions = roles held union direct grants.
    - `auth.access-control.role-editor-ui` · `not-started` · **Role editor UI** — Firm-facing role editing surface. _Note: Named as a later additive seam._
    - `auth.access-control.access-requests` · `partial` · **Access requests and direct grants** — Within-firm denial is 403 plus request-access; approver writes an optionally time-boxed direct grant. _Note: Denial surface shipped; the request-to-grant flow is an explicit seam. The separate support-access framework (support_grant) covers platform staff, not member grants._
    - `auth.access-control.cross-firm-404` · `shipped` · **404-not-403 boundary** — Cross-firm and unauthorized-but-existing resources return 404 so responses are never an existence oracle; 403 reserved for within-firm denial.
    - `auth.access-control.location-filter` · `not-started` · **Location as view filter** — Office as a list/search/report filter, never an access gate; hard per-location separation a reserved seam. _Note: Locations entity shipped; the filter surfaces are UI-gated._
    - `auth.access-control.ethical-walls` · `deferred` · **Ethical walls** — Content-screening overlay (header visible, contents screened) for the rare conflict. _Note: Explicitly deferred until a concrete use case exists; kept as a seam._
  - `auth.encryption` · `partial` · **Encryption and key management** — App-level encryption scoped to crown-jewel secrets only, giving an audited role-gated read chokepoint; everything else on platform at-rest encryption.
    - `auth.encryption.envelope-keys` · `shipped` · **Envelope key hierarchy** — Root KEK as Worker secret wrapping a per-firm key; HKDF-derived purpose keys (pii, secrets, index); AES-KW/AES-GCM/HKDF/HMAC via Web Crypto.
    - `auth.encryption.protected-fields` · `shipped` · **protected() field chokepoint** — Declarative field type encrypting on write, role-gated audited decrypt on read, inside the data-access layer — no separate crypto service.
    - `auth.encryption.blind-index` · `shipped` · **HMAC blind index** — Blind index so conflicts matching works over encrypted identifiers without decrypting.
    - `auth.encryption.firm-secrets` · `shipped` · **Per-firm plugin credentials** — getSecret/putSecret for per-firm plugin credentials; ciphertext in the firm database, plugin Workers never see key material.
    - `auth.encryption.crypto-shred` · `shipped` · **Per-firm crypto-shred** — Destroying a firm's wrapped key renders its encrypted corpus permanently unreadable — instant per-firm offboard. _Note: Function only; the offboarding flow that invokes it is its own future design._
    - `auth.encryption.key-rotation` · `deferred` · **Key rotation machinery** — Root rotation (rewrap firm keys) and per-firm rotation (re-encrypt the small sensitive set). _Note: Explicitly deferred until needed; the versioned-envelope seam is built._
    - `auth.encryption.post-quantum` · `partial` · **Post-quantum posture** — Symmetric corpus already quantum-resistant; crypto-agility via per-ciphertext algorithm/key version identifiers; PQ signatures seamed on upstream standards. _Note: Agility seam shipped; PQC-TLS gap logging for third-party endpoints and signature migration not built._
    - `auth.encryption.totp-seed-exception` · `shipped` · **TOTP seed placement** — TOTP seeds stay in Better Auth's tables under its at-rest encryption (user-owned, pre-firm-context), verified against the pinned version.
    - `auth.encryption.kms-rooted-kek` · `deferred` · **External KMS-rooted KEK** — AWS-KMS-anchored root key as a hardening upgrade (Cloudflare offers no application-data HSM). _Note: Explicit backlog hardening item; PQC-wrapped-key support named as a selection criterion._

### Calendar and Rules-Based Docketing

[`roadmap.d/calendar.md`](../roadmap.d/calendar.md) — 13 nodes, 38% shipped. 5 done, 1 part-built, 7 ahead, 0 parked.

- `calendar` · `partial` · **Calendar and docketing** — Calendar surface for matters, deadlines, and appointments; two-way external sync; rules-based court-deadline computation.
  - `calendar.events` · `shipped` · **Litigation events and deadlines** — Member-entered hearings, filings, service, orders, depositions and the like, plus first-class deadlines with a stated authority, satisfaction, and a vacate/supersede trail. _Note: Backend only — the calendar screens are their own slice._
  - `calendar.timeline` · `shipped` · **Matter timeline (federated)** — One ordered history per matter across every subsystem that already records what the firm did, read in place through a source registry under one cursor and one visibility contract. _Note: Backend only — the calendar screens are their own slice._
  - `calendar.firm-events` · `shipped` · **Firm events** — Events that belong to the firm rather than to a case — meetings, closures, training, holidays, reservations — with an all-members/participants audience and the same civil-date/zone model as case events. _Note: Backend only — the calendar screens are their own slice._
  - `calendar.resources` · `shipped` · **Rooms and resources** — Bookable firm resources (rooms, vehicles, equipment) with availability as a read, bookings attached to exactly one event, liveness derived from event status, and double-booking as a warn-and-allow visible fact. _Note: Backend only. A per-firm hard-refuse booking policy, approval workflows, and room-panel sync are named seams._
  - `calendar.links-continuance` · `shipped` · **Event links and continuance** — Typed relations between events, and continuance as a new setting pointing at the vacated one — old row byte-untouched, chain held by partial unique indexes, no deadline ever moved. _Note: Backend only. Continuance binds matter events; a moved staff meeting stays an edit._
  - `calendar.surface` · `not-started` · **Calendar surface** — Calendar of matters, deadlines, and appointments.
  - `calendar.sync` · `not-started` · **Two-way Google/Outlook sync** — Two-way calendar synchronization via the email/calendar plugin.
  - `calendar.docketing` · `researching` · **Rules-based docketing** — Compute court dates and deadlines from jurisdiction/court rule sets, defaulting from the matter's jurisdiction or home Location.
    - `calendar.docketing.rule-sets` · `researching` · **Court rule sets** — Sourcing, encoding, and maintaining per-jurisdiction/court rule sets.
    - `calendar.docketing.computation` · `not-started` · **Deadline computation** — Trigger-to-deadline model — court holidays, service-method offsets, chained deadlines, recalculation when a trigger moves.
    - `calendar.docketing.review` · `not-started` · **Reviewer confirmation** — Human confirmation step before computed dates take effect.
  - `calendar.reminders` · `not-started` · **Deadline reminders** — Computed dates and appointments feed reminders through the Communications layer.

### Communications Layer

[`roadmap.d/communications.md`](../roadmap.d/communications.md) — 21 nodes, 14% shipped. 3 done, 4 part-built, 13 ahead, 1 parked.

- `communications` · `partial` · **Communications layer** — Email, messaging (SMS/MMS/RCS), and voice/telephony unified behind one templating and trigger engine, all logged to the matter/Directory.
  - `communications.email` · `partial` · **Email** — Dual send paths — firm's own mailbox for matter correspondence, transactional provider for billing/system mail — plus the in-house parse engine.
    - `communications.email.transactional` · `shipped` · **Transactional email adapter** — Billing/system mail through a transactional provider adapter.
    - `communications.email.filing` · `partial` · **Firm-mailbox email filing** — Matter correspondence through the firm's own Gmail/Outlook mailbox via the email plugin, threaded in the mailbox and logged to the matter. _Note: Slice 1 is the record model plus forward/CC capture, functionally complete pending the deploy that activates the inbound route; the firm-mailbox Gmail/Outlook plugin path is not built._
      - `communications.email.filing.capture-addresses` · `shipped` · **Capture-address management** — Minting, rotating, and revoking the forward/CC capture address a matter files mail through, plus the firm's single catch-all address. _Note: Backend and user guide only — no screens yet; a minted address becomes routable on the next per-firm outbox sweep, and the capture-subdomain DNS onboarding is still a deploy step._
      - `communications.email.filing.auto-file-rules` · `partial` · **Auto-file rules** — Typed, matter-bound, revocable rules that route captured mail to a matter unattended, behind a fixed set of fail-closed guardrails and a staged-by-default consent posture. _Note: The rule model, the capability, the pure guardrail decision, and the evaluation that runs during a capture — the port on the capture core and the evidence gatherer in the consumer are both built, so a rule now fires on real mail. The circuit-breaker thresholds are a per-firm setting with the shipped numbers as defaults, bounded so the protection cannot be configured away, and an out-of-range threshold stages the message as unevaluable rather than being clamped to something nobody chose. Still missing: the management routes and the review read. No screens._
    - `communications.email.parse-engine` · `shipped` · **Email parse core** — Pure-Rust .eml/.msg/mbox parse engine on the engine-host seam with WASM edge, wrapper package, and Email Inspector tool route. _Note: Parse-only; the communications capture subsystem builds on this record model later._
  - `communications.messaging` · `not-started` · **Messaging (SMS/MMS/RCS)** — CPaaS behind a messaging port serving outbound notifications, SMS 2FA, access codes, and two-way client texting.
    - `communications.messaging.port` · `not-started` · **Messaging port** — Swappable CPaaS adapter with per-firm scoped secrets.
    - `communications.messaging.notifications` · `not-started` · **Outbound notifications** — Appointment/deadline/payment reminders and invoice/report-ready notices over messaging.
    - `communications.messaging.two-way-texting` · `not-started` · **Two-way client texting** — Inbound and outbound conversations threaded and logged to the matter/Directory.
    - `communications.messaging.sms-2fa` · `not-started` · **SMS 2FA factor** — SMS as an authentication second factor.
    - `communications.messaging.rcs` · `not-started` · **RCS enhancement** — RCS as progressive enhancement over SMS/MMS with verified branded sender and auto-fallback.
    - `communications.messaging.compliance` · `not-started` · **Messaging compliance** — A2P 10DLC/toll-free/RCS-brand registration as procurement prerequisite; TCPA consent and STOP/HELP opt-out enforced in the port.
  - `communications.voice` · `not-started` · **Voice and telephony** — Inbound call handling behind a telephony port — recording to per-firm R2, media-stream fork, call log and transcript on the Directory/matter.
    - `communications.voice.transcription` · `not-started` · **In-house transcription** — Call audio transcribed on Cloudflare Workers AI so privileged audio never egresses to the carrier. _Note: Same capability later serves preview transcript-sync and discovery/deposition media._
    - `communications.voice.consent` · `not-started` · **Call-recording consent gating** — Recording consent gated by the jurisdiction-profile machinery (one-party vs all-party states).
    - `communications.voice.e911` · `deferred` · **E911 posture** — Emergency-calling registration if a real outbound office line is offered; a pure inbound intake line sidesteps it.
  - `communications.telnyx` · `not-started` · **Telnyx launch adapter** — One vendor covering SMS/MMS/RCS plus voice with bidirectional media streaming and Ed25519-signed webhooks; Twilio/Bandwidth/Plivo as swaps.
  - `communications.templates-triggers` · `not-started` · **Templates and trigger engine** — Channel-aware templates feeding one automation/trigger engine; first automations are invoices/statements, payment reminders, scheduled reports and deadline reminders.
  - `communications.matter-logging` · `not-started` · **Communication logging** — All communication across all three channels logged to the matter/Directory under the redact-by-default telemetry discipline.

### Community & Feedback Forum

[`roadmap.d/community.md`](../roadmap.d/community.md) — 11 nodes, 0% shipped. 0 done, 0 part-built, 10 ahead, 1 parked.

- `community` · `designed` · **Community and feedback forum** — Public, platform-level, cross-firm surface for feature requests with voting, peer discussion, known issues, and roadmap/changelog views; never touches per-firm confidential data.
  - `community.board` · `designed` · **Feedback board** — Feature requests with popularity-ranked upvotes, comments, tags, status pipeline, and roadmap-as-filtered-view-by-status.
  - `community.package` · `designed` · **Extractable community package** — Clean @magna-carta/community package, platform-level and isolated from the per-firm data-access layer.
  - `community.confidentiality` · `designed` · **Confidentiality boundary** — Posting always opt-in and user-authored; nothing flows automatically from private matters or the private bug pipeline into the public forum.
  - `community.identity` · `designed` · **Display-name identity and SSO** — Better Auth SSO with display-name-only public identity; real name/firm never shown; aggregate vote counts only.
  - `community.escalation-bridge` · `designed` · **Private-report escalation bridge** — One-way, user-opted escalation of a private diagnostic report into a public feature request or known-issue check.
  - `community.known-issues` · `designed` · **Known-issues view** — Public known-issues view mirroring the live status content.
  - `community.changelog-sync` · `designed` · **Shipped-items changelog sync** — Requests marked shipped sync to the changelog; popular requests inform the roadmap.
  - `community.agent-status-posts` · `designed` · **Agent status posts** — Maintenance/diagnostics agents post public status on known issues, propose-only, never exposing privileged detail.
  - `community.discussion` · `deferred` · **Open discussion forum** — General peer-discussion forum beyond the feedback board.
  - `community.moderation` · `designed` · **Moderation and abuse handling** — Permanent moderation, spam/abuse, and security operation of a public board, owned in-house.

### Conflicts Check

[`roadmap.d/conflicts.md`](../roadmap.d/conflicts.md) — 9 nodes, 11% shipped. 1 done, 1 part-built, 7 ahead, 0 parked.

- `conflicts` · `partial` · **Conflicts Check** — Firm-wide conflict checking across the Directory graph and matter role-links, with configurable strictness/depth, human clearance, and an immutable log. _Note: Remote branch slice-4-1-conflicts exists but contains merge commits only (docs/maintenance/reports/2026-07-14-baseline.md) — not counted as in-build._
  - `conflicts.directory-seams` · `shipped` · **Directory matching seams** — Name normalization, phonetic keys, entity search, and duplicate-detection/merge machinery in the Directory.
  - `conflicts.triggers` · `not-started` · **Check triggers** — Run checks at intake, whenever a party is added, and on optional periodic re-scans.
  - `conflicts.matching-engine` · `researching` · **Matching engine** — Candidate generation and scoring over names/identifiers (exact, fuzzy, phonetic, alias/blind-index) with related-party edge expansion. _Note: Phonetic and normalization primitives already shipped in packages/directory._
    - `conflicts.matching-engine.strictness` · `not-started` · **Configurable strictness** — Balanced default with an over-inclusive fuzzy/phonetic/alias mode a firm can enable.
  - `conflicts.search-depth` · `not-started` · **Configurable search depth** — Structured Directory/matter scan by default; optional document-content scan.
  - `conflicts.firm-wide-scope` · `not-started` · **Firm-wide imputation** — Conflicts impute across the whole firm and every office; locations never partition the conflicts graph.
  - `conflicts.clearance` · `not-started` · **Human clearance** — Reviewer adjudicates hits; clearance records waiver obtained or ethical wall erected.
  - `conflicts.log` · `not-started` · **Immutable conflicts log** — Every check and clearance recorded in an immutable, defensible log.

### Core Domain — Directory, Matters & Locations

[`roadmap.d/core-domain.md`](../roadmap.d/core-domain.md) — 72 nodes, 43% shipped. 31 done, 33 part-built, 7 ahead, 1 parked.

- `directory` · `partial` · **Directory** — Single source of truth for every person and organization, modeled as a graph of entities and typed edges. _Note: Backend complete on main; UI deferred until the design-system app shell lands._
  - `directory.entities` · `partial` · **Person and Organization entities** — Distinct Person and Organization types with equal data depth; full contact core (typed emails/phones/addresses, notes) on every entity regardless of role. _Note: Backend shipped; no entity UI yet (ui todo in status.d/1-3-directory.md)._
    - `directory.entities.categories` · `partial` · **Entity categories** — Per-firm classification labels (attorney, judge, court, expert, vendor, client) that are not schema variants. _Note: Backend shipped; category management UI not built._
    - `directory.entities.category-fields` · `partial` · **Category-specific custom fields** — Category-specific data (bar number, jurisdiction, specialty/rate) defined through the shared custom-fields engine; add-only, equal depth preserved. _Note: Engine shipped (see custom-fields.\*); field-definition and entry UI not built._
  - `directory.names` · `partial` · **Structured names and name history** — Structured person names (prefix/first/middle/last/suffix), aliases/AKAs, maiden and former names, preferred/display name; org legal name, DBAs/trade names, former names; retained name-change history. _Note: Backend shipped including phonetic codes on every name row; UI not built._
  - `directory.pronouns` · `partial` · **Pronouns on a person** — Optional, owner-entered pronouns on a Directory person — the whole declension plus verb agreement — feeding the document-assembly pronoun helpers; never inferred from a name, a title, or a gender attribute. _Note: Backend shipped; the entry surface (common-set presets plus free-form entry) is deferred to the owner with the rest of the Directory UI. A separate gender field is deliberately not built and is flagged for the owner._
  - `directory.edges` · `partial` · **Typed edges** — First-class typed, dated edges between entities (affiliations, relationships, representation, role assignments) with valid-from/valid-to. _Note: Backend shipped; edge management UI not built._
    - `directory.edges.affiliations` · `partial` · **Affiliations (person-org)** — Typed, dated person-to-organization links (officer, employee, partner, member, registered agent, attorney-at-firm) with per-contact flags (primary, billing, do-not-contact). _Note: Typed/dated edges shipped; the promised contact flags (primary/billing/do-not-contact) were not found in the schema or package._
    - `directory.edges.relationships` · `partial` · **Relationships (person-person, org-org)** — Typed relationship edges — spouse/family, guardian/ward, trustee, beneficiary, business partner; corporate parent/subsidiary/successor/affiliate — feeding conflicts, estate planning, corporate work. _Note: Backend shipped; conflicts engine that consumes these is not built (slice-4-1-conflicts branch has no work yet)._
    - `directory.edges.representation` · `partial` · **Representation edges** — Counsel-represents-party edges scoped within a matter. _Note: Backend edge type shipped; no UI._
    - `directory.edges.role-assignments` · `partial` · **Matter role assignments** — Entity-to-matter role links with the role on the link, not the entity; one entity can hold multiple roles in one matter. _Note: Backend shipped; party management UI not built._
  - `directory.identifiers` · `partial` · **Typed identifiers** — Typed identifier list (bar number, EIN/Tax ID, SSN, DOB, driver's license) used for conflicts, billing, and document generation. _Note: Backend shipped; UI not built._
    - `directory.identifiers.protected-fields` · `shipped` · **Field-level encryption and access control** — Sensitive fields (SSN, EIN, DOB, financial) structurally encrypted via the data-access protected() field type with HMAC blind index so conflicts can match without decrypting; access logged.
  - `directory.duplicates` · `partial` · **Duplicate detection** — Fuzzy name + identifier matching on entry and import surfacing possible-duplicate candidates. _Note: Candidate engine shipped; entry-time "possible duplicate?" prompt is UI, not built._
  - `directory.merge` · `partial` · **Non-destructive merge** — Merge folds a duplicate into a master, repoints every reference, archives (never deletes) the subordinate, and records survivorship plus the exact repoint list in an append-only entity_merge event. _Note: Backend shipped; merge tooling UI not built._
    - `directory.merge.unmerge` · `deferred` · **Guarded unmerge** — Reversal of a recent, still-clean merge; locked once post-merge activity accrues. _Note: Deferral-with-seam, not a retrofit; no unmerge export exists in packages/directory._
  - `directory.archival` · `shipped` · **Soft-delete and archival** — Entities referenced by a matter or the conflicts log are archived, never hard-deleted.
  - `directory.temporal-audit` · `shipped` · **Temporal history and audit** — Key fields (names, addresses, affiliations, roles) time-bounded (valid-from/valid-to) to answer "what was true then"; every change audited (who/what/when).
  - `directory.legacy-id` · `not-started` · **Legacy source-system ID** — A legacy source-system identifier on every entity for LEAP migration traceability. _Note: LEAP migration itself is deferred (ADR-0021); this lands with that slice._
- `matters` · `partial` · **Matters** — Matter as the top-level access unit and cost center, opened directly with the client as a Directory link. _Note: Backend shipped; matter UI in flight (matter-detail skeleton design, file-surface-web stream) but not landed as a usable surface._
  - `matters.parties` · `partial` · **Matter parties** — Parties attached via Directory role-links; multiple roles per entity on one matter. _Note: Backend shipped; UI not built._
  - `matters.numbering` · `partial` · **Configurable matter numbering** — Firm-configurable numbering scheme engine (ordered segment template, counters) drawing the number at open. _Note: Backend shipped; scheme configuration UI not built._
    - `matters.numbering.location-segment` · `shipped` · **Location segment in numbering** — Optional location segment/prefix in the numbering scheme.
  - `matters.types` · `partial` · **Flexible matter types** — Matter types carrying type-specific fields for mixed practices, via the shared custom-fields engine. _Note: Backend shipped; practice-area templates explicitly deferred (status.d/1-4: "before first client"); UI not built._
    - `matters.types.templates-workflows` · `not-started` · **Per-type templates and workflows** — Matter types carrying document templates and workflows. _Note: Depends on document automation._
  - `matters.home-location` · `partial` · **Optional home Location** — A matter optionally assigned to a firm office, which supplies its number prefix, letterhead/remit-to on generated documents and bills, and per-location reporting; firm default otherwise. _Note: Link and number-prefix shipped; letterhead/remit-to on documents and bills awaits billing and document automation; per-location reporting awaits the reports slice._
  - `matters.lifecycle` · `partial` · **Matter lifecycle** — Prospective, Open, Closed statuses; Open draws the matter number; Closed is archived-but-additive with reopen support. _Note: Backend shipped; lifecycle UI not built._
    - `matters.lifecycle.consultations` · `partial` · **Consultations (prospective matters)** — Unnumbered lightweight matters kept out of the main list, surfaced in a per-attorney Consultations virtual view; parties feed conflicts permanently; conflicts run at intake. _Note: Backend shipped; Consultations folder view is UI (not built); the conflicts engine that runs at intake is not built (slice-4-1-conflicts branch empty)._
    - `matters.lifecycle.close-preconditions` · `shipped` · **Close-precondition hook** — Named close-precondition registry run at close; any failure blocks the close; empty until the Financial Core registers "all bills paid, no remaining balance". _Note: The zero-balance rule registration belongs to the trust slice and is not yet registered._
    - `matters.lifecycle.stale-consultations` · `partial` · **Stale-consultation policy and bulk close** — Per-firm age policy flags stale consultations for bulk close; closed prospectives retained forever as conflict history. _Note: Flagging backend shipped; the bulk-close affordance is UI and no bulk-close operation was found._
  - `matters.file-manager` · `partial` · **File Manager** — Navigation over the matter's versioned R2 files — folders, document types, drag/drop. _Note: Backend and file-manager primitives on main; the Files UI is queued behind the app shell (status.d/1-1 next)._
    - `matters.file-manager.content-hash` · `shipped` · **Content hash on every stored object** — SHA-256 computed at write time for fixity, delta verification, duplicate detection, upload short-circuit, scan-verdict caching, and no-op version skip. _Note: Cross-matter blob dedup deliberately undecided per the white paper._
    - `matters.file-manager.bulk-download` · `shipped` · **Bulk download (zip)** — Streaming, store-mode, ZIP64 archives of selected files/folders or a whole matter, versions pinned at request time, access-checked and audit-logged; single-file selections download directly. _Note: Client-portal reuse awaits the portal (not built)._
      - `matters.file-manager.bulk-download.async-jobs` · `shipped` · **Async bulk-download jobs** — Seam switching very large bundles to an async job producing an R2 artifact behind a signed URL. _Note: White paper scoped v1 to live-stream only; the async path was built anyway per the 2-1 plan._
    - `matters.file-manager.upload` · `shipped` · **Direct-to-R2 inbound upload** — Worker mints presigned URLs and records metadata; presigned PUT for small files, resumable S3 multipart above a threshold; per-firm max-size/content-type policy enforced at presign and re-verified at the quarantine gate. _Note: Client portal and Discovery reuse await those subsystems._
    - `matters.file-manager.untrusted-pipeline` · `partial` · **Untrusted-file pipeline** — Every uploaded byte treated as untrusted — gates, quarantine, scanning, safe delivery, continuous re-scan. _Note: Children mix shipped and deferred; EICAR live check deferred (no prod users)._
      - `matters.file-manager.untrusted-pipeline.pre-acceptance` · `shipped` · **Pre-acceptance gates** — Authenticated upload, per-firm size and content-type allow-list, magic-byte validation, decompression-bomb and nested-archive guards, filename sanitization.
      - `matters.file-manager.untrusted-pipeline.quarantine` · `shipped` · **Quarantine-on-arrival** — Bytes land not visible/servable/indexed until cleared; async scan via R2 event, Queue, scanner; verdict stored as file metadata; quarantine, never auto-delete.
      - `matters.file-manager.untrusted-pipeline.scan-engine` · `partial` · **Malware scan engine port** — Scanning as a swappable port with one or more engines behind it; no privileged bytes leave firm-controlled infrastructure. _Note: Baseline engines shipped; the concrete commercial engine choice is explicitly deferred behind the port (its own future ADR)._
      - `matters.file-manager.untrusted-pipeline.cdr` · `not-started` · **CDR disarmed renditions** — Optional disarmed copy of document types while the original is preserved byte-for-byte for evidence. _Note: Named optional in the pipeline design; engine choice deferred._
      - `matters.file-manager.untrusted-pipeline.safe-delivery` · `shipped` · **Safe delivery (structural)** — Separate cookieless sandbox origin, CSP, iframe sandbox, safe-rendition preview defeating stored-XSS uploads. _Note: Player/preview UI queued behind the app shell._
      - `matters.file-manager.untrusted-pipeline.rescan` · `partial` · **Continuous re-scan** — Re-scan sweep on signature updates via cron fan-out; audit every verdict; alert staff on hits. _Note: Access-triggered rescan exists; the signature-update cron sweep was not verified in tree._
- `locations` · `partial` · **Locations (offices)** — First-class per-firm entity for physical offices; a dimension within the firm tenancy boundary, referenced by matters, trust accounts, Custodian roots, users, and generated documents. _Note: Backend shipped; administration UI not built._
  - `locations.fields` · `partial` · **Location fields** — Name/label, active/closed status, physical addresses + contact info, jurisdiction, letterhead and branding assets (logo, address block, footer, remit-to), optional matter-number prefix/segment. _Note: Core fields shipped; branding assets (logo, address block, footer) beyond remit-to were not found — they land with document automation consumers._
  - `locations.staff-assignment` · `shipped` · **Staff assignment** — Users belong to one or more locations with exactly one designated primary.
  - `locations.usage` · `partial` · **Location consumers** — The surfaces a Location feeds — matters, trust accounts, Custodian roots, generated output
    - `locations.usage.matters` · `shipped` · **Location on matters** — Optional home-Location reference supplying number prefix and firm-default fallback.
    - `locations.usage.trust-accounts` · `designed` · **Location on trust accounts** — Each trust account associated with a Location; jurisdiction trust-rule profile binds per account. _Note: No trust-account code in tree yet._
    - `locations.usage.custodian` · `designed` · **Location as Custodian root** — Physical-location hierarchy rooted at a Location (Location, safe, box, position).
    - `locations.usage.documents-billing` · `not-started` · **Location identity on generated output** — Location fields feed the data dictionary so generated documents and invoices carry correct office identity. _Note: The source data (remit-to, addresses) is shipped; no consumer exists._
  - `locations.access-model` · `shipped` · **Location as filter, not gate** — Location is a view/reporting filter; data stays firm-wide open by default; hard per-location separation is a reserved seam.
  - `locations.soft-delete` · `shipped` · **Location soft-delete** — A Location referenced by a matter, trust account, or custody record is closed/archived, never hard-deleted.
- `custom-fields` · `partial` · **Custom-fields engine** — Shared typed custom-fields engine serving Directory categories and matter types. _Note: Backend shipped; definition/entry UI deferred until the app shell._
  - `custom-fields.typed` · `shipped` · **Typed fields and values** — Typed field definitions with value coercion, picklist options, and limits.
  - `custom-fields.stable-identity` · `shipped` · **Stable field identity** — Renaming a field never breaks stored data or templates.
  - `custom-fields.convert` · `shipped` · **Non-destructive retype** — Retyping is a guided, reversible convert. _Note: The guided UX is UI and not built; the reversible conversion machinery is._
  - `custom-fields.retire` · `shipped` · **Archive and gated purge** — Retiring a field archives it without losing history; purge is gated.
  - `custom-fields.temporal-audit` · `shipped` · **Temporal history and audit** — Value history retained over time; changes audited.
  - `custom-fields.consumers` · `partial` · **Searchable, reportable, automation-usable** — Custom fields usable in search, reporting, and document automation. _Note: Read primitives exist; reporting (reports slice) and document automation (status.d/2-6 not started) consumers do not._
- `matter-assets` · `partial` · **Matter asset register** — Per-matter register of what a client or an estate owns — the asset row, a closed platform class with a per-firm type catalog under it, structured attributes per class, dated valuations, interests, encumbrances, documents, and the estate schedule. _Note: All ten classes, encumbrances and equity, the grouped schedule, the custody link, and the merge subjects are built. Still open — the firm's own fields on an asset, the load-profile asset corpus, carry-forward from a prior matter, the integration adapters, and portal visibility. No user interface._
  - `matter-assets.register` · `partial` · **The asset row and the class spine** — An asset rooted NOT NULL to one matter, a closed ten-value platform class, a per-firm type catalog under that class, a frozen class, an asserted estate treatment and disposition, and soft delete. _Note: All ten classes are available to the write path. Two fields make a row (class and description) — the deliberate inversion of Custodian's mandatory owner link._
  - `matter-assets.attributes` · `shipped` · **Per-class structured attributes** — One one-to-one attribute table per class that has structure, with indexes on the identifiers people search by; no table for a class that has none. _Note: personalProperty and other carry no table by design. A public-record identifier is a plaintext searchable column; matter_asset_digital_asset has no column a credential could ride on, and the write path refuses one by name._
  - `matter-assets.valuations` · `shipped` · **Append-only valuation history and the as-of read** — Dated valuations on a closed basis vocabulary, corrected by compensating rows, with the as-of resolution that returns amount, date, and basis together — and no current-value column anywhere. _Note: A date before an asset's first valuation resolves to nothing rather than to the earliest figure; no route edits or deletes a recorded value._
  - `matter-assets.interests` · `shipped` · **Interests held by directory entities** — Who holds a stake, under a firm-configurable label, as a rational share, temporally end-dated rather than deleted. _Note: Optional by design — an estate where everything is the decedent's records none. Nothing derives estate treatment from an interest label or the reverse._
  - `matter-assets.documents` · `shipped` · **Document links over ordinary matter files** — Many-to-many links from an asset to already-ingested matter files, with no upload path of its own. _Note: Deliberately not unique on file_id, diverging from custody_scan — one brokerage statement lists four accounts._
  - `matter-assets.identifiers` · `shipped` · **Protected identifiers and the credential refusal** — Full account, policy, certificate, and tax numbers sealed with only the last four characters readable; public-record identifiers left plaintext and searchable; credentials refused outright. _Note: One audited read path, a named refusal rather than a blank without the decrypt permission, and no merge facet for a protected value._
  - `matter-assets.encumbrances` · `shipped` · **Encumbrances and net equity** — Mortgages, liens, and security interests with their own dated balances, and equity computed per currency as of a date. _Note: Equity is computed and never stored, and withheld rather than approximated — an unrecorded balance or a mixed-currency pair makes it unavailable with a named reason, and negative equity is reported as negative. Releasing writes a date; nothing disappears._
  - `matter-assets.schedule` · `shipped` · **The estate schedule** — Grouped by class as of a date, with value, basis, actual as-of date, unreleased encumbrances, equity, per-class subtotals per currency, and a stated unvalued count. _Note: Not a court form and not a stored document — a read. The as-of date is required with no default, `undetermined` is its own group, the unvalued count is stated rather than hidden, and a group's equity subtotal is withheld when one balance in it is unstated._
  - `matter-assets.class-handling-notice` · `shipped` · **Class handling notices** — A standing, non-jurisdictional sentence on a class whose type carries known legal handling, rendered and acted on by nothing. _Note: The register records what is held and encodes no transfer law; a verified jurisdiction catalog is a separate build behind primary-source research._
  - `matter-assets.custody-link` · `shipped` · **The custody item link** — One nullable column joining a scheduled asset to the custody item that physically holds it, with neither side copying the other's facts. _Note: No unique index — the same held object can be scheduled in two matters. custody_item.declared_value_amount_minor and a valuation answer different questions; nothing syncs them, and the package names no custody declared-value column at all._
  - `matter-assets.merge-fields` · `shipped` · **Asset subjects in the merge catalogue** — Collection-only merge subjects per class plus an aggregate, filled by one new assembly source, with value and its date declared together and no protected value as a facet. _Note: No assetClass subject declares a scalar — an estate with two houses would make every scalar an absence naming the count. `value` and `valueAsOf` are declared and set together; accountSuffix is the facet and the full number has no key. custom_field.target widening to matterAsset is still open and wants coordinating with the Custodian custodyPacket widening._
  - `matter-assets.carry-forward` · `planned` · **Carry-forward from a prior matter** — Copying selected assets into another matter as new rows with recorded provenance, never a shared row. _Note: Valuations do not copy by default — a value asserted in one matter as of one date is not an assertion in another._

### Custodian (Safe Custody)

[`roadmap.d/custodian.md`](../roadmap.d/custodian.md) — 12 nodes, 50% shipped. 6 done, 3 part-built, 1 ahead, 2 parked.

- `custodian` · `partial` · **Custodian** — Register of physical client originals held in safekeeping — what the firm holds, where it is, whose it is — with custody log, labels, scans, and reminders. _Note: Backend only — no UI. Receipts, portal visibility, stocktake, the destruction workflow, and the will-on-death engine are not built._
  - `custodian.register` · `shipped` · **Item register** — Item model with type, description, intrinsic-value flag, mandatory Directory owner link(s), co-ownership form, depositor, optional matter link, status. _Note: The design splits packet (unit of custody) from item (unit of description); co-ownership is a firm-configurable role label rather than a platform enum of tenancy forms._
  - `custodian.location-hierarchy` · `shipped` · **Physical location hierarchy** — Recursive container tree rooted at a Location (office), default safe > box > position, arbitrary depth. _Note: A root optionally binds a firm Location; an offsite or bank root binds none, so a vault never becomes an office row._
  - `custodian.custody-ledger` · `shipped` · **Check-in/out custody log** — Append-only ledger of custody events (logged, moved, checked out, returned, released, destroyed) with actor and timestamp. _Note: Recording, not gating, with one deliberate exception — a check-out captures the borrower and a due-back date but blocks nothing, while a release is gated (see custodian.checkout-workflow) because it is the only movement that cannot be undone._
  - `custodian.labels` · `shipped` · **Labels and barcodes** — Printable barcode/QR labels on items and containers. _Note: Linear Code 128 only; QR waits for stocktake, which is the first capability that would use it._
  - `custodian.review-reminders` · `partial` · **Review dates and the reminder feed** — Firm-set review dates on packets and items with an anniversary-anchored cycle, and one collection point serving both due reviews and overdue check-outs. _Note: Partial because delivery is not built — the emission point is a query the reports read; Notifications subscribes to it rather than defining what is due a second time._
  - `custodian.reports` · `shipped` · **Register reports** — Holdings per owner, occupancy per location including subtree counts, holds in force, and overdue check-outs.
  - `custodian.scans` · `shipped` · **Attached digital scans** — R2 digital scans attached to each custody item. _Note: A matterless packet files its scans onto a per-firm system holding matter, so file.matter_id stays NOT NULL. A scan satisfies no gate the original would not._
  - `custodian.retention-destruction` · `designed` · **Retention and destruction dates** — Retention/destruction dating with the intrinsic-value flag blocking routine destruction of irreplaceable originals. _Note: Owner-gated and deliberately unbuilt. The platform ships NO retention period, default, derived date, or sweep — there is no retention_until column at all, and a review date is not a retention clock._
  - `custodian.will-reminders` · `deferred` · **Will release-on-death reminders** — Per-state will-deposit deadline engine (jurisdiction-keyed catalog) driving release reminders.
  - `custodian.checkout-workflow` · `partial` · **Gated release and signed receipts** — Named-borrower check-out/return, gated release with identity and authority captured before an original leaves, and signed deposit/release receipts. _Note: Partial because receipts are not built. The authority is free text a firm writes and no platform vocabulary — what document suffices to release an original is jurisdiction-specific and remains an owner decision. Two-signatory release is a per-firm policy, off by default. Receipt GENERATION waits on an assembly path that is matter-routed and matter-permissioned; receipt BINDING already ships, since a signed receipt links to its packet as a custody_scan of kind receipt._
  - `custodian.stocktake` · `deferred` · **Scan-to-locate and stocktake** — Barcode scan-to-locate and stocktake reconciliation over the container tree.

### Design System, UI Consistency & Design Quality

[`roadmap.d/design-system.md`](../roadmap.d/design-system.md) — 20 nodes, 60% shipped. 12 done, 7 part-built, 1 ahead, 0 parked.

- `design-system` · `partial` · **Design system** — UI consistency prevented by construction (tokens, one component source, CI) and design quality set by a human foundation with an enforced review step. _Note: Foundation built and merged; close-out items open (NVDA passes, owner Storybook sign-off, first container VRT baselines, dark design pass)._
  - `design-system.tokens` · `partial` · **Design tokens** — Every color/spacing/radius/shadow/type/z/motion/breakpoint value a named DTCG token; no raw values elsewhere.
    - `design-system.tokens.dtcg-resolver` · `shipped` · **DTCG source with Resolver theming** — Spec-pure W3C DTCG source; themes and light/dark carried entirely by resolver contexts, pure data on html attributes.
    - `design-system.tokens.terrazzo-pipeline` · `shipped` · **Terrazzo generation** — Terrazzo build to committed CSS custom properties with golden-file byte pins and generator invariant gates (Style Dictionary portability accepted).
    - `design-system.tokens.theme-gallery` · `shipped` · **Curated theme gallery** — Six-theme gallery times light/dark modes as resolver contexts; adding a theme is a data change, zero component changes.
    - `design-system.tokens.per-firm-branding` · `partial` · **Per-firm branding generation** — Generated accessible palettes from firm anchor colors via the Culori engine. _Note: Engine built but unexposed to firms, matching the white paper's built-but-unexposed framing._
    - `design-system.tokens.tailwind-theme` · `shipped` · **Tailwind v4 token binding** — Tailwind configured via @theme to consume only generated tokens so off-scale values cannot be expressed naturally.
  - `design-system.components` · `shipped` · **Component library** — In-house @magna-carta/design-system styled directly on headless Bits UI v2 — the only primitives the app may compose. _Note: shadcn-svelte (original choice) replaced after an adversarial stress test; Bits scroll-lock CSP patch carried in patches/._
    - `design-system.components.storybook-catalog` · `shipped` · **Component catalog** — Storybook as the single place components are defined and reviewed; stories triple as behavior tests and axe accessibility checks. _Note: Histoire dead without Svelte 5 support, as the white paper records._
    - `design-system.components.icons` · `shipped` · **Lucide icons, no emojis** — Lucide as the only icon source; emojis banned everywhere and machine-enforced.
  - `design-system.enforcement` · `partial` · **Machine enforcement** — Lint forbids arbitrary/off-token values; catalog plus visual regression catch drift in CI.
    - `design-system.enforcement.off-token-lint` · `shipped` · **Off-token value gates** — Fitness gates rejecting arbitrary values, raw colors, raw z/duration numerals, bits-ui boundary violations, non-token CSS.
    - `design-system.enforcement.visual-regression` · `partial` · **Visual regression testing** — Playwright screenshots across every theme and mode over the story matrix; Argos the named upgrade. _Note: Harness and CI job built; first container-rendered baselines still pending; Argos not adopted._
  - `design-system.design-language` · `shipped` · **Design language foundation** — Human-set distinctive, restrained language: type system, palette with intent, legal power-user density, functional motion, signature elements. _Note: Dark design pass named as a remaining close-out item._
  - `design-system.page-archetypes` · `shipped` · **Page archetypes** — Canonical page templates (List/Index, Record Detail, Editor, Form/Wizard, Dashboard) fixing layout grammar, hierarchy, and full state sets. _Note: Archetype application across feature screens rides each UI slice._
  - `design-system.ui-pipeline` · `partial` · **UI build pipeline** — Per-slice staged roles: interaction design, implementation, design critique against an anti-generic rubric, accessibility, visual regression.
    - `design-system.ui-pipeline.critique-rubric` · `shipped` · **Design critique standard** — Explicit anti-generic and usability rubric as the practitioner standard for the judgment gate.
    - `design-system.ui-pipeline.accessibility` · `partial` · **Keyboard-first accessibility** — Keyboard-first and WCAG; axe checks enforced in stories; screen-reader passes per tier. _Note: Per-tier NVDA passes pending per STATUS close-out list._
  - `design-system.fixtures-density` · `shipped` · **Real-density UI data** — UI built and reviewed on load-profile fixtures — real density, long values, empty states, large lists — never toy data.
  - `design-system.microcopy-glossary` · `not-started` · **Domain-grounded microcopy** — Microcopy drawn from a canonical legal-domain glossary shared with user documentation.

### Discovery (e-discovery)

[`roadmap.d/discovery.md`](../roadmap.d/discovery.md) — 23 nodes, 17% shipped. 4 done, 12 part-built, 5 ahead, 2 parked.

- `discovery` · `partial` · **Discovery** — E-discovery for moderate scale (thousands to tens of thousands of docs per matter) with seams for larger scale; ingest, OCR, index, review, production. _Note: The search index has its stateful-service spec (docs/specs/2026-07-17-discovery-search-index-stateful-service-design.md), the design ADR-0167 deferred; the white paper defers several remaining engine questions to the subsystem._
  - `discovery.pipeline` · `partial` · **Extraction pipeline** — Ingest to R2, queue-driven extraction/OCR in Containers, then index. _Note: The engine is dual-target (native + wasm32) with committed cross-target vectors, so desktop-local processing and the server produce byte-identical passages._
    - `discovery.pipeline.engine` · `shipped` · **Discovery engine core** — Pure-Rust, I/O-free engine — identify from bytes, native text extraction, the determinism boundary, passage chunking, five-algorithm digests, the near-duplicate fingerprint, guarded archive expansion. _Note: Backend only, no user surface. The composite extraction port that routes to it — and closes the born-digital-PDF gap platform-wide — is a later sub-slice._
    - `discovery.pipeline.review-set` · `partial` · **Review-set model** — The corpus object — review sets, loads, review documents as pointers, record custodians, occurrences, exceptions, and the load manifest. _Note: The transcript include/exclude control is a required field with no default on every load declaration, and the scope is stored on the load so the manifest states what the corpus was drawn from. The per-review-set access list is now built and fail-closed (ADR-0270) — no row means no access, the predicate composes into SQL before the LIMIT, and a member not on a list gets 404 rather than 403._
    - `discovery.pipeline.load-lanes` · `partial` · **Load source lanes** — Where material comes from — the firm's own matter files, its filed email, a production received from another party, and collection from a client's own system. _Note: direct-collection is declared and refused BY NAME so its absence is visible rather than mysterious — it needs a collection tool, not an ingest path. Assistant transcripts are likewise refused by name until their lane lands with the review surface._
  - `discovery.ocr` · `shipped` · **OCR engine** — PaddleOCR PP-OCR models run as ONNX through a Rust ort pipeline, one pinned versioned model set for server Container and desktop. _Note: UI todo; ocr-raster-cap-and-skip-gate branch in flight; Tesseract/ocrs fallbacks and docTR head-to-head resolve in the future discovery subsystem spec._
  - `discovery.archive-handling` · `shipped` · **Opaque archive storage** — Uploaded archives stored opaque (versioned, hashed, on the matter); never expanded server-side.
    - `discovery.archive-handling.contents-indexing` · `partial` · **Archive contents in review** — Indexing, reviewing, and producing archive contents via client/desktop-side extraction and re-upload. _Note: A received production arrives as a zip, so a discovery subsystem that cannot open one cannot ingest an external production at all._
  - `discovery.search` · `partial` · **Search** — Full-text and semantic search over the discovery corpus.
    - `discovery.search.keyword` · `partial` · **Tantivy keyword search** — Tantivy (Rust) behind a swappable index interface.
    - `discovery.search.semantic` · `designed` · **Semantic search** — Vectorize-backed semantic search alongside keyword search.
  - `discovery.review` · `partial` · **Review workflow** — Filter by date/custodian/party/keyword, tag documents, redact, thread email, detect near-duplicates.
    - `discovery.review.filters` · `not-started` · **Review filters** — Filtering the corpus by date, custodian, party, and keyword.
    - `discovery.review.tagging` · `partial` · **Tagging and coding** — Responsive/privileged/confidential document tagging, coded per document, with family and bulk as scopes rather than storage. _Note: Backend only — the coding panel, tag chips and viewer pane are deferred to the owner. Criteria-driven bulk at corpus scale waits on the corpus index read._
    - `discovery.review.redaction` · `partial` · **Redaction** — Applied redactions on documents under review.
    - `discovery.review.email-threading` · `not-started` · **Email threading** — Thread email documents during review.
    - `discovery.review.near-duplicates` · `not-started` · **Near-duplicate detection** — Detect near-duplicate documents in the review set.
  - `discovery.production` · `partial` · **Production workflow** — Bates numbering, applied redactions, and privilege log with defensibility built in.
    - `discovery.production.bates` · `shipped` · **Bates numbering engine** — Bates stamping of produced documents. _Note: Engine only; production-set workflow integration pending._
    - `discovery.production.privilege-log` · `not-started` · **Privilege log** — Privilege log generated from tagged documents in a production.
    - `discovery.production.defensibility` · `partial` · **Defensibility** — Per-document hashing, content-addressed storage, chain of custody, audit log.
  - `discovery.scale` · `deferred` · **Large-scale evolution** — Index sharding, massively parallel OCR, TAR/predictive coding.
  - `discovery.desktop-local` · `deferred` · **Desktop local processing** — Tauri desktop performs local ingest/OCR/indexing for speed, with server fallback.

### Document Automation

[`roadmap.d/document-automation.md`](../roadmap.d/document-automation.md) — 9 nodes, 11% shipped. 1 done, 7 part-built, 1 ahead, 0 parked.

- `document-automation` · `partial` · **Document Automation** — Conditional assembly of .docx templates from matter data, with a data dictionary and dedicated PDF form filling. _Note: A firm can register a .docx template and assemble it onto a matter today; the output is filed through the existing ingest chokepoint._
  - `document-automation.conditional-assembly` · `shipped` · **Conditional document assembly** — Merge fields plus conditional clauses/sections driven by matter data. _Note: Aggregates over a repeat collection are built — sum, minimum, and maximum over a literal field path of a list-valued key, bounded exactly as a repeat is. An aggregate over an empty collection is an absence rather than a zero._
  - `document-automation.docx-templates` · `partial` · **DOCX template authoring** — Templates authored as .docx for formatting control, bound to the data dictionary. _Note: Word MERGEFIELD conversion is detected always and applied only on explicit opt-in._
  - `document-automation.data-dictionary` · `partial` · **Data dictionary** — Directory/Matter/Location/custom/financial fields exposed as a merge-field dictionary.
  - `document-automation.location-identity` · `partial` · **Location-resolved office identity** — Office name, address, letterhead, remit-to, and jurisdiction resolve from the matter's home Location so generated documents carry the correct office identity.
  - `document-automation.generation-engine` · `partial` · **Generation engine** — In-house TypeScript OOXML merge in a Worker queue consumer; heavy DOCX-to-PDF via the office engine in a Container.
  - `document-automation.pdf-form-filling` · `partial` · **Dedicated PDF form filling** — Court/government fillable PDFs filled via the PDF engine. _Note: Binding firm-supplied fillable PDFs to the same data dictionary is slice 2-6-3._
  - `document-automation.field-mapping-library` · `not-started` · **Per-firm merge-field mapping library** — A firm-scoped store of confirmed Word-field-name to merge-field-key mappings, so a second template import reuses what the first established.
  - `document-automation.filing-grade-generation` · `partial` · **Filing-grade generation** — Court documents generated from vetted templates (optionally tweaked in Collabora) rather than co-edited from scratch.

### Documents

[`roadmap.d/documents.md`](../roadmap.d/documents.md) — 115 nodes, 52% shipped. 60 done, 28 part-built, 23 ahead, 4 parked.

- `documents` · `partial` · **Documents** — Matter document storage and tooling — file manager, upload/ingest, malware scanning, editing, versioning/tiering, preview, conversion, PDF services, e-signature, bundling, OCR, repair, decryption, metadata, integrity, type verification, email parsing. _Note: Backend/engine depth far ahead of user-facing surfaces; web file surface in flight._
  - `documents.file-manager` · `partial` · **File Manager** — Navigation over the matter's versioned R2 files — folders, document types, drag/drop, bulk download, content hashing, storage metering. _Note: Backend shipped; user-facing surface is the file-surface-web stream._
    - `documents.file-manager.folders` · `shipped` · **Folder navigation** — Folder model, CRUD, and listing over the firm-scoped data-access layer.
    - `documents.file-manager.document-types` · `shipped` · **Document types** — Per-firm document-type taxonomy attached to files.
    - `documents.file-manager.ui-primitives` · `shipped` · **File UI primitives** — FileIcon, Breadcrumb, ContextMenu, Tree, Dropzone design-system components for file surfaces. _Note: Container VRT baselines and NVDA pass still outstanding per the fragment._
    - `documents.file-manager.matter-files-ui` · `in-build` · **Matter Files surface** — The matter's documents on real rows — the list, both creation paths (a file, or a template assembly), saving a new version, the version history, and the editing-session launch. The multi-view browser (collection region + capability detail pane) is the next layer over it. _Note: The Collabora editor needs the deployed magna-carta-edit container; folders, rename, and download are the next additions._
    - `documents.file-manager.file-inspector` · `in-build` · **File Inspector workbench** — Tools-host of the file surface for inspecting an ephemeral (non-matter) file through the same capability pane.
    - `documents.file-manager.content-hash` · `shipped` · **Content hashing at write** — SHA-256 recorded for every stored object at ingest — fixity, duplicate detection, scan-verdict caching, no-op version skip.
    - `documents.file-manager.bulk-download` · `shipped` · **Bulk download (zip)** — Streaming store-mode ZIP64 archive of selected files/folders/matter, version-pinned, RBAC-gated, audit-logged, memory-flat.
      - `documents.file-manager.bulk-download.async` · `shipped` · **Async bulk bundle** — Large bundles run as a tracked background job (Durable Object) building an R2 artifact fetched by signed URL.
    - `documents.file-manager.storage-metering` · `shipped` · **Storage metering** — Per-firm rollup of bytes and object counts by storage class and key prefix, feeding Analytics Engine and firm-usage diagnostics.
  - `documents.upload` · `partial` · **Upload & ingest pipeline** — Uniform direct-to-R2 inbound upload with quarantine-gated ingest; bytes never transit the Worker. _Note: Upload UI rides the file-surface-web stream (Dropzone primitive shipped; dev upload route on main)._
    - `documents.upload.direct-to-r2` · `shipped` · **Direct-to-R2 transfer** — Presigned single PUT for small files, resumable S3 multipart above a threshold; Worker only authorizes, mints URLs, records metadata.
    - `documents.upload.policy-gates` · `shipped` · **Pre-acceptance gates** — Per-firm size and content-type allow-list enforced at presign and re-verified against real bytes; magic-byte validation; filename sanitization.
    - `documents.upload.quarantine` · `shipped` · **Quarantine-on-arrival** — Bytes land at their final key not visible/servable/indexed until the async ingest consumer clears them (gates, SHA-256, scan port, version commit in one read).
    - `documents.upload.archive-opacity` · `shipped` · **Opaque archive storage** — Uploaded archives stored versioned/hashed on the matter and never expanded server-side — no zip-bomb/nested-archive read pipeline exists.
  - `documents.scanning` · `partial` · **Malware scanning** — Async scan of every uploaded byte behind a swappable port; verdict stored as file metadata; quarantine, never auto-delete. _Note: EICAR live check deferred (no production users yet)._
    - `documents.scanning.port` · `shipped` · **Scan port** — ScanPort seam in the file-manager package so scan engines are swappable without touching the pipeline.
    - `documents.scanning.engine` · `shipped` · **In-house scan engine (YARA + raw facts)** — YARA Forge rule packs plus a raw-facts extraction engine running in a dedicated scan container behind its own worker.
    - `documents.scanning.policy` · `shipped` · **Per-firm scan policy** — Firm-configurable tier and suspicious-score floor turning raw facts into verdicts; score-histogram seam for threshold tuning.
    - `documents.scanning.verdict` · `shipped` · **Verdict as file metadata** — clean/flagged/unscanned verdict persisted per version; flagged versions never served; infected files quarantined, never deleted.
    - `documents.scanning.rescan` · `shipped` · **Re-scan on signature updates** — Access-triggered re-scan with a content-hash + engine-version scan cache, so an engine/signature update forces re-scan on next access.
    - `documents.scanning.tool-ui` · `shipped` · **Malware Scan tool page** — User-facing scan/diagnose tool in the Tools area.
    - `documents.scanning.cdr` · `not-started` · **CDR disarmed rendition** — Optional content-disarmed copy of document types while the original is preserved byte-for-byte for evidence.
    - `documents.scanning.waf-prefilter` · `not-started` · **WAF edge pre-filter** — Cloudflare WAF content scanning as a detect-only Layer-0 on proxy-transiting form uploads. _Note: Explicitly an engine option behind the port; Enterprise add-on, does not see direct-to-R2 traffic._
    - `documents.scanning.commercial-engine` · `not-started` · **Commercial engine behind the port** — A commercial AV engine (Sophos/Bitdefender/Kaspersky/OPSWAT class) run on our own compute behind the scan port. _Note: The white paper defers the concrete engine choice; the port and YARA baseline exist._
  - `documents.editing` · `partial` · **Editing (Collabora & WOPI)** — Collabora Online on Containers as the sole .docx editor, real .docx in R2 as source of truth, app-owned WOPI host.
    - `documents.editing.collabora-host` · `shipped` · **Collabora container host** — One container per open document, spun up on demand by a Durable Object and reaped when idle, in a dedicated edit worker.
    - `documents.editing.wopi-host` · `shipped` · **WOPI host & version-cut policy** — WOPI callbacks with autosave-aware version cutting (explicit save and session close cut versions; autosaves overwrite current) and timestamp-guarded current overwrite.
    - `documents.editing.checkout` · `shipped` · **Offline checkout / check-in** — Optimistic checkout with check-in reconciliation and an active-to-stale-to-released idle-checkout sweep on cron.
    - `documents.editing.editor-ui` · `planned` · **Editor UI** — In-app surface that opens a document in the Collabora frame. _Note: Gated on the app-shell / file-surface streams._
    - `documents.editing.native-editor` · `cut` · **Native CRDT editor** — A second, lightweight Yjs/CRDT working-doc editor alongside Collabora.
  - `documents.versioning` · `partial` · **Versioning & storage tiering** — App-managed immutable version objects (not R2 native versioning) with per-version storage class and lifecycle.
    - `documents.versioning.app-managed` · `shipped` · **App-managed version objects** — Churning current key overwritten per save; immutable vN snapshots cut deliberately, never per autosave.
    - `documents.versioning.tiering` · `shipped` · **Supersede-to-IA tiering** — Superseded versions transitioned Standard to Infrequent Access server-side on a sweep; tiering, never pruning.
    - `documents.versioning.storage-encoding-seam` · `shipped` · **storage_encoding seam** — Version metadata discriminator (full today, patch encoding later) so nothing outside the data-access layer assumes a version object is raw bytes.
    - `documents.versioning.delta-storage` · `deferred` · **Version-history delta storage** — Superseded versions re-stored (ZIP entries stored, not deflated) as zstd patch-from deltas with keyframes and roundtrip-hash verification, as an async Queue/Container job.
    - `documents.versioning.deleted-lifecycle` · `partial` · **Deleted-file lifecycle** — Soft-delete trash window (Standard) then IA cold retention then policy-driven destruction blocked by holds; default retention indefinite.
      - `documents.versioning.deleted-lifecycle.trash` · `shipped` · **Trash & restore** — Soft-delete hides the record from the File Manager (firm-scoped state change, bytes untouched); restore clears the flag in place.
      - `documents.versioning.deleted-lifecycle.cold-retention` · `not-started` · **Trash-expiry IA transition** — After the trash window, deleted objects transition Standard to IA in place via the same server-side copy used for superseded versions.
      - `documents.versioning.deleted-lifecycle.destruction` · `not-started` · **Policy-driven destruction** — Per-record retention/destruction date driving audited hard-delete, blocked by legal/discovery/Custodian holds; ships defaulted off (indefinite).
  - `documents.preview` · `partial` · **Inline file preview** — Files viewed in place (video first) with download alongside; untrusted bytes delivered safely.
    - `documents.preview.signed-delivery` · `shipped` · **Authorization-gated delivery** — Short-lived tokened URLs minted only after matter/RBAC checks; originals stream from R2 (progressive playback, free egress).
    - `documents.preview.sandbox-origin` · `shipped` · **Safe-delivery sandbox** — Untrusted bytes served from a separate cookieless files._ origin with attachment disposition, correct Content-Type, nosniff, restrictive CSP, iframe sandbox.
    - `documents.preview.inline-playable` · `shipped` · **inlinePlayable verdict** — Cheap container/codec sniff recorded per version at ingest; preview policy serves inline only on a playable verdict. _Note: Firm-wide Reports rollup of the verdict awaits the Reports subsystem._
    - `documents.preview.safe-rendition` · `partial` · **Derived safe renditions** — Active formats previewed only via a derived rasterized/transcoded rendition (artifact_role derived version), never the raw file. _Note: Rasterize/transcode engine wires in with the player UI._
    - `documents.preview.player` · `designed` · **Video player UI** — Vidstack-based inline player with consistent themed controls; HLS support dormant for future transcoding.
    - `documents.preview.transcoding` · `deferred` · **Preview transcoding** — Self-hosted FFmpeg (Queues + Container) MP4 renditions for non-web formats; clip/annotation, transcript sync, adaptive bitrate.
  - `documents.conversion` · `partial` · **In-app file conversion** — In-house any-format to any-format converter; bytes stay in-tenant (R2 to our compute to R2); original never mutated.
    - `documents.conversion.registry` · `shipped` · **Format registry & pathfinding** — Declarative (source, target) to {engine, recipe} table with weighted single-engine edges and multi-hop chain computation; single source of format knowledge.
    - `documents.conversion.port` · `shipped` · **ConversionPort & adapters** — Port/adapter seam so engines are testable and swappable; external adapters deliberately not enabled.
    - `documents.conversion.api` · `shipped` · **Conversion API** — Upload-and-submit conversion endpoints in the OpenAPI contract. _Note: Execution currently limited to the built engine edges (raster, image-to-PDF)._
    - `documents.conversion.raster` · `shipped` · **Raster image engine** — Pure-Rust image conversion engine in a dedicated container behind the convert worker (memory-safe replacement for native libvips).
    - `documents.conversion.image-to-pdf` · `shipped` · **Image to PDF** — Image-to-PDF conversion edge on the registry.
    - `documents.conversion.office` · `planned` · **Office document conversion** — Documents/spreadsheets/presentations to/from PDF via the server office engine (LibreOffice-class, container-bound). _Note: The C++ LibreOffice runtime is owner-consented under golden rule 14, scoped to the dlopened suite; the build phase is next._
    - `documents.conversion.av-transcode` · `not-started` · **Audio/video transcodes** — Self-hosted FFmpeg transcode edges (shared with the preview transcoding path).
    - `documents.conversion.email-to-pdf` · `not-started` · **Email MSG/EML to PDF** — Render parsed email as PDF for producing email as exhibits; closes the registry's eml/msg edges.
    - `documents.conversion.searchable-pdf` · `not-started` · **Scanned PDF to searchable PDF** — OCR text layer applied to scanned PDFs via the OCR pipeline.
    - `documents.conversion.background-jobs` · `partial` · **Background job orchestration** — Durable Object per job holding queued/running/per-item progress, container spin-up/sleep, completion notification for large or batch conversions. _Note: Single-file jobs only — per-item batch progress and completion notification are not built, and container spin-up/sleep applies to the raster container alone._
    - `documents.conversion.output-placement` · `in-build` · **Output placement** — Per-job choice of save-into-matter (versioned R2 sibling, audit-logged) or download a copy.
    - `documents.conversion.convert-ui` · `designed` · **Convert-to menu / converter tool UI** — Data-driven Convert-to menu answered by the registry; file-converter tool surface.
  - `documents.pdf` · `partial` · **PDF services** — Unified PDF operation service — client-side WASM by default, server only for seal, no-client, server-only-engine, and batch cases. _Note: ADR-0045 marks the whole PDF/e-signature design provisional pending verification._
    - `documents.pdf.engine` · `shipped` · **Pure-Rust engine core** — crates/pdf-core compiled to WASM for client and Worker, superseding the composed pdf-lib/PDFium/qpdf roster with one memory-safe engine.
    - `documents.pdf.render` · `shipped` · **Render to raster** — PDF page rendering for preview/flatten via the pure-Rust engine (hayro dependency doctrine).
    - `documents.pdf.redaction` · `shipped` · **True redaction (rasterize route)** — Content-removing redaction via the rasterize route — underlying content destroyed, not covered. _Note: Resolves in-house the AGPL-engine dilemma the white paper carried to Discovery._
    - `documents.pdf.redaction-detector` · `shipped` · **Bad-redaction detector** — Detects cover-up-style redactions with recoverable underlying text (observing-device model).
    - `documents.pdf.scrub` · `shipped` · **PDF document scrub** — Removes hidden content and metadata from PDFs.
    - `documents.pdf.surgery` · `partial` · **Structural surgery & repair** — Content-stream and structural PDF surgery (the qpdf role, in-house): repair, restructure, linearize-class operations.
    - `documents.pdf.bates` · `shipped` · **Bates numbering** — Bates stamping across documents with configurable format/position.
    - `documents.pdf.forms` · `shipped` · **PDF form fill** — AcroForm form filling in the pure-Rust engine. _Note: XFA not in scope of the built module._
    - `documents.pdf.watermark` · `shipped` · **Stamp / watermark** — Stamping and watermarking pages.
    - `documents.pdf.secure` · `shipped` · **Secure / encrypt** — PDF encryption, passwords, and permissions (plus decrypt support).
    - `documents.pdf.generate` · `shipped` · **Generate primitives** — Programmatic PDF generation (text, standard fonts, drawing primitives) for invoices/reports/certificates.
    - `documents.pdf.decompression-guard` · `shipped` · **Decompression-bomb guard** — Raw-bytes pre-flight guard against decompression bombs before engine work. _Note: Decision fragment pdf-decompression-guard still pending assembly (unnumbered)._
    - `documents.pdf.manipulation` · `not-started` · **Merge / split / rotate / flatten** — Page-level manipulation operations promised for the PDF service.
    - `documents.pdf.tool-uis` · `not-started` · **PDF tool UIs** — User-facing PDF tools (redact, Bates, forms, secure, etc.) in the Tools area.
  - `documents.esignature` · `partial` · **E-signature** — First-party e-signature on the PDF engine — sender field placement, signing UI, PAdES platform seal, audit trail, certificate of completion, attribution tiers. _Note: ADR-0045 records the whole area as provisional — every license/legal specific to be re-verified before build._
    - `documents.esignature.pades-seal` · `shipped` · **PAdES platform seal** — Server-applied tamper-evidence seal with the firm certificate on completed documents. _Note: ADR-0206 resolves the Worker-crypto vs Container question in favour of pkijs over WebCrypto in the Worker. Baseline B-B only — timestamp/LTV levels (B-T/B-LT/B-LTA, needs a TSA) and independent-validator conformance remain._
    - `documents.esignature.signing-flow` · `not-started` · **Signing flow & adoption UI** — Client-side field placement, signing UI, signature adoption (type/draw/upload).
    - `documents.esignature.audit-trail` · `partial` · **Audit trail & certificate of completion** — Server-observed signer IP/timestamp/consent/document hash assembled into a stored Certificate of Completion. _Note: The certificate can be assembled and rendered, but nothing yet captures a signer's consent through a signing flow, and the certificate is not stored against a document._
    - `documents.esignature.attribution` · `not-started` · **Attribution assurance tiers** — Configurable signer assurance — authenticated internal, tokenized link, email/SMS code, ID/KBA, portal-authenticated.
    - `documents.esignature.vendor-port` · `not-started` · **Vendor adapter seam** — Plugin-port seam for a third-party trust-service adapter (certified filing, remote online notarization).
  - `documents.bundling` · `partial` · **Enhanced bundling** — Matter bundle export with format choice, compression, AES-256 encryption, and multi-volume output, in two lanes.
    - `documents.bundling.light-lane` · `shipped` · **TypeScript bundle lane** — In-Worker lane for plain streaming bundles (formats/layout/manifest/options in the file-manager package).
    - `documents.bundling.container-lane` · `shipped` · **Container bundle lane** — Heavy/encrypted lane — alternative formats, compression, AES-256, multi-volume — in a dedicated Rust container behind its own worker. _Note: Lanes return 503 until the image is deployed and BUNDLE_SERVICE binds (per the status fragment)._
    - `documents.bundling.ui` · `not-started` · **Bundling UI** — User-facing bundle configuration surface.
  - `documents.ocr` · `partial` · **OCR** — PaddleOCR models via ort/ONNX in a container behind a dedicated worker; identical output wherever it runs.
    - `documents.ocr.engine` · `shipped` · **ocr-core engine** — PP-OCR ONNX model pipeline (small tier) through Rust ort, with pinned SHA-256-guarded model set. _Note: ADR-0060 selected PP-OCRv5; the built engine runs PP-OCRv6 per the status fragment._
    - `documents.ocr.api` · `shipped` · **OCR API** — POST /api/v1/ocr behind the tools:ocr permission.
    - `documents.ocr.raster-cap` · `in-build` · **Raster cap & skip gate** — Caps raster size and skips already-text pages in the OCR path.
    - `documents.ocr.ui` · `not-started` · **OCR tool UI** — User-facing OCR tool surface.
    - `documents.ocr.desktop-local` · `not-started` · **Local OCR on desktop** — Same pinned model set compiled native for the Tauri client so desktop ingest OCRs locally.
  - `documents.file-repair` · `partial` · **File repair & salvage** — Diagnose/repair/carve corrupted files with an honest per-run loss manifest, re-scanned output, and chain-of-custody provenance. _Note: Decision fragments file-repair-single-container-lane and engine-host-r2-optional pending assembly (unnumbered)._
    - `documents.file-repair.format-pillars` · `shipped` · **Format repair pillars** — ZIP/OOXML, CFB/OLE2, PDF xref-rebuild, and content-carving repair pillars in pure Rust (native-only).
    - `documents.file-repair.stateless-api` · `shipped` · **Stateless repair API** — /api/v1/file-repair/{diagnose,repair,carve}; reconstructed output re-scanned and withheld if flagged.
    - `documents.file-repair.attach-to-matter` · `shipped` · **Attach repaired output to matter** — Repair/carve outputs saved as server-side uploads through the ingest gate (new version or new files; flagged goes to quarantine) with loss manifest persisted per version.
    - `documents.file-repair.ui` · `not-started` · **File repair UI** — User-facing repair/salvage surface.
  - `documents.decryption` · `partial` · **File unlock & password recovery** — Unlock password-protected files with a known password; recover forgotten passwords by coordinated candidate search. _Note: Decision fragments decryption-file-unlock-recovery and decryption-recovery-orchestration pending assembly (unnumbered)._
    - `documents.decryption.unlock` · `shipped` · **Inspect & unlock** — PDF/ZIP/OOXML inspect + unlock via a FormatAdapter, pure Rust compiled to both WASM and native.
    - `documents.decryption.recovery` · `shipped` · **Password recovery orchestration** — Durable-Object-coordinated fan-out over recovery-worker shards with a hash-only boundary (privileged bytes never leave; only hashes are distributed).
    - `documents.decryption.gpu` · `in-build` · **GPU recovery rungs** — GPU-accelerated recovery tiers above the CPU shards.
    - `documents.decryption.ui` · `not-started` · **Unlock/recovery UI** — End-user unlock and recovery surface.
  - `documents.metadata` · `partial` · **Metadata inspector & scrubber** — Inspect and scrub embedded metadata from files before sharing/production.
    - `documents.metadata.ooxml` · `shipped` · **OOXML metadata** — Inspect/scrub DOCX/XLSX/PPTX metadata, stateless.
    - `documents.metadata.image` · `shipped` · **Image metadata** — Inspect/scrub JPEG/PNG/TIFF metadata (EXIF et al.), stateless.
    - `documents.metadata.extended-formats` · `deferred` · **HEIC / PDF / container-engine metadata** — HEIC and PDF metadata handling via a container engine. _Note: PDF-side scrub exists separately in crates/pdf-core (documents.pdf.scrub)._
    - `documents.metadata.ui` · `not-started` · **Metadata tool UI** — User-facing inspect/scrub surface.
  - `documents.file-integrity` · `partial` · **File hash & integrity** — Multi-algorithm streaming hash, ingest-baseline comparison, and verification receipt for evidence-grade fixity. _Note: Backend shipped; tool UI deferred to the shell wave._
  - `documents.file-type` · `partial` · **File type verification** — Content-based file-type identification (Magika ONNX) with filename/extension mismatch analysis and a report. _Note: Backend shipped; UI todo per the status fragment._
  - `documents.email` · `partial` · **Email parsing (email-core)** — Pure-Rust .eml/.msg/mbox parse engine on the engine-host seam with a WASM edge and an Email Inspector tool. _Note: Parse-only by design — rendering and DKIM verification stand outside; container/native lane deferred until Discovery's bulk mbox needs._
    - `documents.email.parse` · `shipped` · **EML / MSG / mbox parse** — Full message parse to a normalized record model.
    - `documents.email.msg-mapi` · `shipped` · **MSG via CFB + in-house MAPI** — .msg read over the cfb crate with MAPI property decoding written in-house.
    - `documents.email.lzfu-rtf` · `shipped` · **LZFu compressed-RTF bodies** — Decoder for compressed-RTF .msg bodies.
    - `documents.email.inspector-tool` · `shipped` · **Email Inspector tool** — Worker route + tool exposing the parse engine.
  - `documents.engine-host` · `shipped` · **Engine-host harness** — Shared hosting seam (format / wasm_edge / host) so pure-Rust file engines run identically as WASM edges and container services. _Note: Status fragment marks tested todo._

### Financial Core

[`roadmap.d/financial.md`](../roadmap.d/financial.md) — 58 nodes, 26% shipped. 15 done, 26 part-built, 14 ahead, 3 parked.

- `financial` · `partial` · **Financial Core** — The firm's money spine — ledger, time, trust, billing, costs, operating books
  - `financial.ledger` · `partial` · **Append-only double-entry ledger** — Single append-only double-entry ledger in D1 serving trust, billing, costs, and operating accounting. _Note: Core shipped; the operating-books extension is in build (children mix shipped and not)._
    - `financial.ledger.append-only` · `shipped` · **Reversals, never edits** — Transactions are never edited, only reversed with new balancing entries; provable correctness and full history.
    - `financial.ledger.operating-gl` · `in-build` · **Operating accounting / general ledger** — Extends the ledger to full firm operating books. _Note: Specs live only on the branch; phase-3 slice map marks this slice loosely coupled._
      - `financial.ledger.operating-gl.chart-of-accounts` · `in-build` · **Chart of accounts** — The product chart-of-accounts the baseline schema defers, with the firm account resolver invoicing needs.
      - `financial.ledger.operating-gl.accounts-payable` · `in-build` · **Accounts payable** — Accounts payable as a subledger of the operating books.
      - `financial.ledger.operating-gl.financial-statements` · `in-build` · **Financial statements** — Trial balance, balance sheet, and income statement read primitives over the operating books.
      - `financial.ledger.operating-gl.quickbooks-sync` · `not-started` · **QuickBooks sync** — QuickBooks as an optional sync, not the system of record. _Note: Bank-feed is a reserved seam per the phase-3 slice map._
  - `financial.time` · `partial` · **Time tracking** — Keyboard-first time capture on every matter (billed on hourly; captured internally on flat-fee/contingency for profitability/realization). _Note: Backend complete; all daily-driver surfaces await the app shell._
    - `financial.time.capture` · `partial` · **Time capture surfaces** — The ways time enters the system — live timer, manual/quick-add, weekly grid, calendar drafts
      - `financial.time.capture.timer` · `partial` · **Single active live timer** — One timer at a time bound to a matter (+ optional UTBMS code + narrative), start/pause/stop, server-persisted state surviving tab close and following across devices, always-visible timer bar. _Note: Server-side timer shipped; the global timer bar is UI, not built._
        - `financial.time.capture.timer.offline-desktop` · `not-started` · **Offline timer in Tauri** — Timer works offline in the desktop shell, then syncs.
      - `financial.time.capture.manual` · `partial` · **Manual entry and quick-add** — Duration or start-end entry, free backdating, one-line quick-add parsing ("0.5 Smith — drafted demand letter"). _Note: Backend shipped; entry UI not built._
      - `financial.time.capture.weekly-grid` · `partial` · **Weekly timesheet grid** — Matters-by-days grid for catching up a whole week. _Note: Backend query shipped; the grid itself is UI, not built._
      - `financial.time.capture.calendar-drafts` · `deferred` · **Calendar-derived drafts** — One-click, user-initiated conversion of a calendar event into a time entry. _Note: No Calendar subsystem exists yet._
    - `financial.time.entry-model` · `shipped` · **Entry anatomy and audit** — Date, timekeeper, required matter, duration, narrative, billable flag, resolved rate, optional UTBMS codes, non-billable category; every change audited.
    - `financial.time.increments-rounding` · `shipped` · **Increments and rounding** — Configurable minimum increment (default 0.1 hr) and rounding rule; firm default with per-client/per-matter override.
    - `financial.time.rates` · `shipped` · **Effective-dated rate engine** — Resolution chain matter rate, client rate, timekeeper standard, role default; multiple rate cards; an entry keeps the rate in force on its date.
    - `financial.time.narrative` · `partial` · **Narrative ergonomics** — Snippet/abbreviation expansion, recent-narrative reuse, per-task-code templates. _Note: Template store shipped; expansion/reuse ergonomics are capture-UI behaviors, not built._
    - `financial.time.lifecycle` · `shipped` · **Draft-to-Billed lifecycle with optional review gate** — Draft (editable) to Billed (locked) by default; firm-configurable Submitted/Approved gate, off by default; post-bill corrections are new adjusting entries. _Note: The Billed transition is exercised at invoice finalize, which is not built yet._
    - `financial.time.wip` · `partial` · **Time is WIP, not a ledger posting** — Unbilled time lives in a work-in-progress store and never touches the ledger; billable time converts to an A/R receivable at invoicing. _Note: WIP store shipped; the WIP-to-A/R conversion belongs to the unbuilt billing slice._
    - `financial.time.my-day` · `partial` · **My Day visibility** — Running billable/non-billable totals, missing-time detection, billable-hour targets (daily/monthly/annual), per-matter and calendar-overlay views. _Note: Backend shipped; the My Day view is UI, not built; calendar overlay is a deferred Calendar-subsystem seam._
    - `financial.time.utilization-reports` · `not-started` · **Utilization and realization roll-ups** — Utilization and realization rolled up into the reports library.
    - `financial.time.utbms` · `shipped` · **UTBMS codes** — UTBMS task/activity codes on entries; e-billing matters require and validate codes at capture.
    - `financial.time.passive-capture` · `deferred` · **Passive/automatic time capture** — Automatic activity capture feeding a draft-approve queue. _Note: Seam only; no capture code._
  - `financial.trust` · `partial` · **Trust accounting** — Per-client trust ledgers, jurisdiction-configurable compliance, reconciliation. _Note: Sub-slice 1 (schema + structural guards) is built; fifteen owner flags from the 2026-08-04 analysis stay open and are refused rather than defaulted in code._
    - `financial.trust.client-ledgers` · `partial` · **Per-client trust ledgers, no negative balance** — Per-client (per-matter) trust subledgers under a per-account roll-up, with a hard no-negative-balance invariant per client ledger.
    - `financial.trust.authorization-policy` · `shipped` · **Disbursement authorization policy (per-firm)** — Who may release money leaving a client ledger, as firm configuration. Authority is a property of the person - a member holding trust:authorize releases alone, in one act; a member without it raises a request that routes to somebody who holds it, and is told who before composing anything. Every per-firm database is seeded with that posture as version 1 (off plus the authority requirement); a firm adds a ceiling above which two people are required by writing a threshold or always version, and above the ceiling the authority requirement binds whichever of the two decides (peer approval). The earned-fee application follows the same policy through the same approval queue; in-flight requests keep the policy version they were submitted under. _Note: Owner-directed. UI deferred. Flagged, not decided - whether the lone-holder exception should count trust:authorize rather than trust:manage (it would relax a firm with several managers and one authority holder), whether a posture relaxation itself takes a second person, and whether matter-to-matter reallocations fall under the policy._
    - `financial.trust.no-commingling` · `shipped` · **No commingling** — Firm and client funds never commingle; fees never touch trust (processor/bank fees debit operating only).
    - `financial.trust.jurisdiction-engine` · `partial` · **Jurisdiction-configurable compliance engine** — A rules profile per state/territory parameterized where states differ (citation, retention, reconciliation cadence, firm-funds allowance, IOLTA model, advance/flat-fee treatment, overdraft reporting, electronic payments, thresholds); rule numbers never hard-coded; Nevada seeded.
      - `financial.trust.jurisdiction-engine.rules-catalog` · `designed` · **Trust-rules catalog (56 jurisdictions)** — Verified research corpus of 56 US jurisdictions across 16 rule dimensions compiled into shared reference data. _Note: Research corpus complete and adversarially verified; the build-data pipeline exists only in the design._
    - `financial.trust.multi-jurisdiction-accounts` · `designed` · **Multiple active jurisdictions per firm** — Each trust account opened in a state carries its own jurisdiction profile and governing-rule citation and is associated with a Location; matter trust activity defaults from the matter's home location.
    - `financial.trust.reconciliation` · `not-started` · **Interactive three-way reconciliation** — Monthly bank reconciliation (manual entry or banking-plugin import), match cleared items, flag outstanding/discrepancies, generate and archive a signed three-way reconciliation, per trust account. _Note: Banking-plugin import additionally depends on an unbuilt banking integration._
    - `financial.trust.close-rule` · `not-started` · **Zero-balance close precondition** — Registers "all bills paid, no remaining balance" on the matter close-precondition hook.
  - `financial.billing` · `partial` · **Billing and invoicing** — Bill generation combining time/fees, costs, and taxes across the four fee models, with a draft-to-finalize lifecycle. _Note: The slice map serializes this after time and costs, which are both on main._
    - `financial.billing.fee-models` · `shipped` · **Fee models** — The four billing arrangements — hourly, flat/fixed, contingency, retainer/evergreen _Note: Built all at once per the owner's docket override of the staged default._
      - `financial.billing.fee-models.hourly` · `shipped` · **Hourly billing** — Hourly bills from billable WIP time at resolved rates.
      - `financial.billing.fee-models.flat-fee` · `shipped` · **Flat/fixed fee** — Flat and fixed-fee billing.
      - `financial.billing.fee-models.contingency` · `partial` · **Contingency and settlement statements** — Contingency agreements (share, costs-before-or-after election), recorded recoveries, and the fee derived at invoice time; settlement disbursement statements splitting client share, fee, costs, and liens. _Note: The fee model is shipped; settlement disbursement statements and lien handling stay deferred to a later financial slice, once a real matter demands them._
      - `financial.billing.fee-models.retainer` · `partial` · **Retainer/evergreen** — Retainer and evergreen billing with auto-replenishment alerts below threshold. _Note: The record and the topic are shipped; the automated below-floor alert belongs to the billing-automations slice, which consumes this same event._
    - `financial.billing.corrections` · `shipped` · **Corrections after finalization** — Credit notes and their lines, the client credit a correction opens when it outruns the unpaid balance, write-offs, and the reversal of a mistaken application. _Note: Two of the three ways to discharge a client credit — a refund from operating and a return to the client's trust ledger — move real money through the operating-disbursement path and stay deferred; setting a credit against a later bill of the same client is built. Credit notes carry no number pending an owner decision._
      - `financial.billing.corrections.contingency-residual` · `shipped` · **Contingency shrunk-basis residual** — Reporting a contingency fee billed beyond what the surviving recovery entitles the firm to, and letting the credit note that resolves it clear the finding. _Note: The platform reports and never issues — what a firm owes back after a settlement collapses is a decision with a client in it._
    - `financial.billing.invoice-composition` · `not-started` · **Invoice composition** — Bills combine time/fees plus costs plus taxes.
    - `financial.billing.location-letterhead` · `not-started` · **Location letterhead and remit-to on invoices** — Invoices carry the home Location's letterhead and remit-to when the matter is location-assigned, snapshotted at finalize.
    - `financial.billing.wip-to-ar` · `not-started` · **WIP to A/R posting at finalize** — At invoice finalize, billable time and cost WIP convert atomically to an A/R receivable ledger entry with the Draft-to-Billed lock.
    - `financial.billing.ledes` · `partial` · **LEDES e-billing** — Export invoices in LEDES 1998B and LEDES XML 2.0/2.1 with UTBMS codes carried through from time and cost entries.
      - `financial.billing.ledes.e-billing-flag` · `shipped` · **Per-matter e-billing flag** — Per-matter flag driving required-code validation upstream in time and cost capture. _Note: Landed early per the phase-3 slice map coordination pin._
      - `financial.billing.ledes.guideline-validation` · `not-started` · **Billing-guideline validation** — Validation against client billing guidelines (rate caps, block-billing/increment rules, required codes) before submission.
      - `financial.billing.ledes.submission` · `not-started` · **Electronic submission path** — A path to electronic invoice submission.
  - `financial.costs` · `partial` · **Costs and expenses (disbursements)** — Per-matter cost entries for advanced hard costs and in-house soft costs, staying unbilled WIP until invoiced. _Note: Backend shipped; cost-entry UI not built; cost-to-A/R conversion and LEDES belong to the billing slice._
    - `financial.costs.entry-model` · `partial` · **Cost entry anatomy** — Per-matter entries with type, Directory-linked vendor, date, hard/soft, billable flag, optional UTBMS expense (E-) code with e-billing validation. _Note: Backend shipped; entry UI not built._
    - `financial.costs.hard` · `partial` · **Hard costs as client receivable** — Firm-advanced third-party costs (filing, recording, service, experts, postage/shipping) advanced as a client receivable and billed back. _Note: Capture shipped; the receivable posting and bill-back happen at the unbuilt billing slice per the slice map._
    - `financial.costs.soft` · `partial` · **Soft/in-house costs** — In-house costs (printing, copies) tracked separately from hard costs. _Note: Backend shipped; UI not built._
    - `financial.costs.markup-trust` · `deferred` · **Markup and pay-from-trust** — Cost markup and paying costs from trust. _Note: Deliberate exclusion with an open seam._
    - `financial.costs.auto-capture` · `partial` · **Integration auto-capture** — Automatic cost capture from integrations (PACER filing fees, shipping, banking operating disbursements). _Note: Arrives plugin-by-plugin per the white paper._
      - `financial.costs.auto-capture.shipping` · `shipped` · **Shipping cost auto-capture** — Purchased shipments flow into recoverable cost charges via the shipment.purchased outbox seam.
      - `financial.costs.auto-capture.pacer` · `not-started` · **PACER filing-fee capture** — PACER integration auto-captures filing fees as costs.
      - `financial.costs.auto-capture.banking` · `not-started` · **Banking disbursement capture** — Banking integration auto-captures operating disbursements.

### Client Intake / CRM

[`roadmap.d/intake.md`](../roadmap.d/intake.md) — 7 nodes, 0% shipped. 0 done, 0 part-built, 7 ahead, 0 parked.

- `intake` · `not-started` · **Client intake / CRM** — Lead pipeline with stages feeding prospective matters, public intake forms capturing prospects into the Directory, and receptionist call intake.
  - `intake.lead-pipeline` · `not-started` · **Lead pipeline** — Pipeline stages and lead lifecycle feeding prospective matters.
  - `intake.public-forms` · `not-started` · **Public intake forms** — Workers-served public forms (fields, validation, spam control) landing submissions as Directory prospects plus prospective matters.
  - `intake.call-intake` · `not-started` · **Receptionist call intake** — Recorded, transcribed inbound calls turned into a Directory prospect plus prospective matter with the transcript attached.
  - `intake.conflict-check` · `not-started` · **Conflict check at intake** — Prospects are conflict-checkable entities from first contact; intake triggers a conflicts check.
  - `intake.crm` · `not-started` · **CRM fields and activities** — CRM-style fields and activity tracking on prospects.
  - `intake.conversion` · `not-started` · **Lead-to-matter conversion** — Converting a prospect/prospective matter into an open matter.

### Integrations & Plugins

[`roadmap.d/integrations.md`](../roadmap.d/integrations.md) — 48 nodes, 35% shipped. 17 done, 8 part-built, 20 ahead, 3 parked.

- `integrations` · `partial` · **Plugin / add-on system** — Ports-and-adapters integration framework, manifest-driven registration, first-party adapters, the Tools catalog, and the future third-party marketplace. _Note: First-party only today; C seam to a marketplace documented, not built._
  - `integrations.port-framework` · `shipped` · **Integration port framework** — Typed category ports with vendor adapters behind them; canonical types, manifest, registry, dispatch, problem mapping.
    - `integrations.port-framework.connections-credentials` · `partial` · **Connection & credential model** — Per-functionality connection persistence and credential storage for adapters; API-key credential kind; OAuth lifecycle. _Note: OAuth connection flow deferred to the first OAuth adapter, gated on Google CASA / Microsoft verification._
  - `integrations.platform-foundation` · `shipped` · **Manifest-driven registration** — One declarative IntegrationManifest per integration; central registry drives route mounting, adapter resolution, and PluginRuntime wiring.
  - `integrations.c-transition` · `deferred` · **Plugin transport progression (C seam)** — In-process plugins now; service-binding Workers (C1) and Workers-for-Platforms isolation for third-party plugins (C2) behind the PluginRuntime seam.
  - `integrations.marketplace` · `not-started` · **Third-party plugin marketplace** — Marketplace catalog of third-party plugins deployed in a dispatch namespace.
  - `integrations.ports` · `not-started` · **Integration category ports** — The named outward-reaching category ports (email/calendar, legal research, accounting, payments, e-signature, messaging, password manager) _Note: The port framework itself is shipped; the first credentialed port (email/calendar) is gated on the compliance review_
    - `integrations.ports.email-calendar` · `designed` · **Email / calendar adapter** — First planned credentialed vendor port: email filing and calendar sync into matters. _Note: Distinct from the built @magna-carta/email parse engine (documents area)._
    - `integrations.ports.legal-research` · `not-started` · **Legal-research port** — Port for CoCounsel/Westlaw, Lexis, PACER adapters; design-the-port-now, license-the-adapter-later.
    - `integrations.ports.accounting-banking` · `not-started` · **Accounting / banking ports** — QuickBooks-class accounting and banking data ports.
    - `integrations.ports.payments` · `not-started` · **Payments port** — Payment processing behind a port, lowest-fee build on raw rails.
    - `integrations.ports.e-signature` · `not-started` · **E-signature port** — External e-signature vendor port complementing the native in-house signing core.
    - `integrations.ports.messaging-voice` · `not-started` · **Messaging (SMS/MMS/RCS) & voice/telephony ports** — Communications-layer channel ports; Telnyx launch adapter, swappable to Twilio/Bandwidth/Plivo.
    - `integrations.ports.password-manager` · `researching` · **Password manager / secrets vault port** — Staff credential sync from the firm's vault (Bitwarden candidate launch adapter); scope of retrieval vs management open.
  - `integrations.shipping` · `partial` · **Shipping & postage** — EasyPost adapter behind a typed ShippingPort: address validation, rate-shopping, label purchase, tracking, refund.
    - `integrations.shipping.easypost-adapter` · `shipped` · **EasyPost adapter & firm routes** — Draft shipment, rate-shop, buy label (PDF copied to firm storage), track, refund; idempotent purchase; shipment/label/tracking tables.
    - `integrations.shipping.certified-mail` · `shipped` · **Certified mail** — USPS Certified Mail with return receipt and signature as a first-class shipment option.
    - `integrations.shipping.tracking-webhook` · `deferred` · **Push-webhook tracking ingress** — Vendor webhook ingestion replacing pull-on-demand tracking.
    - `integrations.shipping.cost-recovery` · `shipped` · **Postage cost-recovery seam** — shipment.purchased event recording postage against the matter for cost recovery.
    - `integrations.shipping.ui` · `deferred` · **Shipping UI** — Firm-facing surface for drafting, buying, and tracking shipments.
  - `integrations.tools-area` · `partial` · **Tools area** — One Tools catalog surfacing first-party utilities and integration-backed tools via left-nav and contextual entry points; presentation layer above the plugin framework.
    - `integrations.tools-area.catalog` · `shipped` · **Tools catalog package** — Single source-of-truth catalog; adding a tool is one manifest entry; reflects connection health without holding credentials.
    - `integrations.tools-area.listing-page` · `shipped` · **Tools listing page** — /tools page rendering the catalog grouped by subject, tiles or dense list, maturity-stage badges.
    - `integrations.tools-area.contextual-entry` · `partial` · **Contextual entry points** — Tools reachable in context — command palette, file-context tags on file-shaped tools; Location/Directory entity entry points.
    - `integrations.tools-area.diagnostics-group` · `shipped` · **Diagnostics group (firm usage)** — Read-only firm usage and connectivity snapshot in the Tools area.
    - `integrations.tools-area.network-speed-test` · `shipped` · **Network speed test** — First tool with its own page: Cloudflare measurement engine, per-direction charts, AIM score, authenticated round-trip probe.
  - `integrations.tools` · `partial` · **First-party tool set** — The credential-less first-party tools surfaced through the Tools area _Note: Backends shipped across the set; tool UIs ride the design-system shell wave_
    - `integrations.tools.government-links` · `shipped` · **Government & licensing links** — Curated deep-links to government portals, business registries, and attorney-license lookups (renamed from parcels).
    - `integrations.tools.property-links` · `shipped` · **Property external links** — Zillow/Redfin/Maps/Realtor deep-links for a Location; pure link helper, not a plugin. _Note: County-assessor provider enrichment in flight on branch property-links-assessor._
    - `integrations.tools.whois` · `shipped` · **WHOIS lookup** — Public domain/IP registration lookup, RDAP-first with legacy port-43 fallback for ccTLDs; firm-internal security hygiene. _Note: Report enrichment in flight on branch whois-report-enrichment._
    - `integrations.tools.safe-browse` · `partial` · **Safe website viewer** — Renders a suspect URL in an isolated remote browser and returns a static snapshot (screenshot, redirect chain, text, links).
    - `integrations.tools.metadata` · `shipped` · **Metadata inspector & scrubber** — Inspect and strip metadata from OOXML and JPEG/PNG/TIFF images; stateless. _Note: HEIC/PDF and a Container engine deferred._
    - `integrations.tools.file-integrity` · `shipped` · **File hash & integrity** — Five-algorithm streaming hash, ingest-baseline compare, integrity receipt; introduced the file context tag.
    - `integrations.tools.file-type` · `shipped` · **File type verifier** — Content-based file-type identification (Magika/ONNX in the scan container) behind a verify endpoint.
    - `integrations.tools.ssrf-guard` · `shipped` · **Outbound SSRF guard** — Shared validation of every user-supplied outbound target before any fetch or render; platform invariant for outbound tools.
  - `integrations.candidates` · `partial` · **Candidate integrations** — The named future integration candidates from the white paper's catalog _Note: Mostly unstarted by design; wellbeing resources shipped early_
    - `integrations.candidates.public-records` · `researching` · **Public records / people search / skip tracing** — Built-in feature (adapter-sourced data) for service of process, asset/witness location, conflicts and intake enrichment.
    - `integrations.candidates.document-comparison` · `not-started` · **Document comparison / proofreading / metadata scrubbing suite** — Built-in redline, proofread, and outbound-document scrubbing (Litera-class capability).
    - `integrations.candidates.transcription-dictation` · `not-started` · **Transcription & dictation** — Built-in capture tied to the telephony port: recording to text to time entries and draft notes; swappable speech engine.
    - `integrations.candidates.wellbeing-resources` · `shipped` · **Wellbeing resources directory** — Per-jurisdiction lawyer-assistance and mental-health resource registry (50 states, DC, territories, national safety net).
    - `integrations.candidates.wellbeing-nudges` · `not-started` · **Practitioner work-session nudges** — Opt-in, user-scoped long-session detection from timer/app activity with proportionate suggestions escalating to wellbeing resources; never management-visible.
    - `integrations.candidates.process-serving` · `not-started` · **Process serving plugin** — Order and track service of process with affidavit returned to the matter (ABC Legal / Proof class); high priority.
    - `integrations.candidates.identity-kyc` · `not-started` · **Identity / AML / KYC / sanctions screening plugin** — Client due diligence at intake feeding conflicts check.
    - `integrations.candidates.ai-drafting` · `not-started` · **AI drafting / legal-AI assistant plugin** — Third-party drafting/review surface (Harvey/Spellbook class), distinct from the legal-research port and native document assembly.
    - `integrations.candidates.automation-bridge` · `not-started` · **Automation bridge plugin** — Zapier/Make/outbound-webhook catch-all over the OpenAPI surface.
    - `integrations.candidates.property-data` · `researching` · **Property data plugin** — Parcel/APN lookup and point-in-time AVM valuation.
    - `integrations.candidates.practice-area-gated` · `not-started` · **Practice-area-gated plugins** — Remote online notarization, court reporting / deposition scheduling, medical-records retrieval, translation/interpretation, expert-witness directories.
    - `integrations.candidates.operational-connectors` · `not-started` · **Operational connectors** — Accounting beyond QuickBooks, BI export, HR/payroll, tax 1099/W-9, e-fax, marketing/reviews; lower differentiation.

### Maintenance Agents

[`roadmap.d/maintenance-agents.md`](../roadmap.d/maintenance-agents.md) — 12 nodes, 0% shipped. 0 done, 6 part-built, 6 ahead, 0 parked.

- `maintenance-agents` · `partial` · **Maintenance agents** — Scheduled propose-only Claude agents plus CI tooling (open PRs/reports, never auto-merge; trust/ledger/conflicts paths always human-reviewed).
  - `maintenance-agents.security` · `not-started` · **Security agent** — pnpm/cargo audit, CVE triage, secret scanning on a schedule.
  - `maintenance-agents.dependency-upgrade` · `not-started` · **Dependency & framework upgrade agent** — Svelte/Rust/Tauri/Workers upgrade proposals.
  - `maintenance-agents.platform-watch` · `not-started` · **Cloudflare platform-watch agent** — Track D1/Workers/Containers platform changes and flag impact.
  - `maintenance-agents.compliance-watch` · `not-started` · **Compliance-watch agent** — Bar/IOLTA rule-change monitoring keeping the trust catalog current.
  - `maintenance-agents.competitive-watch` · `not-started` · **Competitive-watch agent** — Monitor competitor changelogs/feature pages; flag new features and gaps.
  - `maintenance-agents.diagnostics` · `not-started` · **Diagnostics agent** — Triage incoming incident reports, correlate to traces, draft root-cause, propose draft-PR fixes, acknowledge the reporter.
  - `maintenance-agents.docs-maintenance` · `in-build` · **Docs-maintenance system (docs-sync)** — Per-merge deterministic fragment assembly plus a weekly judgment-bearing propose-only routine: draft changelog fragments, flag coverage gaps, roll up ROADMAP, one PR per run.
    - `maintenance-agents.docs-maintenance.per-merge-assembly` · `in-build` · **Per-merge fragment assembly workflow** — CI workflow on every push to main folding changelog.d/, docs/decisions/pending/, and status.d/ into the rendered trackers.
    - `maintenance-agents.docs-maintenance.weekly-routine` · `in-build` · **Weekly docs-sync routine** — Scheduled fresh-session routine executing .claude/skills/docs-sync/SKILL.md; audits the merge window, opens one docs-sync PR.
    - `maintenance-agents.docs-maintenance.run-reports` · `in-build` · **Run-report registry** — One append-only report per run under docs/maintenance/reports/ carrying machine-readable window state.
    - `maintenance-agents.docs-maintenance.ci-doc-hygiene` · `partial` · **Deterministic doc-hygiene CI rules** — CI-side lint for cross-reference violations, process-ref scanning, and fragment validity — the deterministic residue the agent must not own.

### Notifications

[`roadmap.d/notifications.md`](../roadmap.d/notifications.md) — 15 nodes, 7% shipped. 1 done, 6 part-built, 4 ahead, 4 parked.

- `notifications` · `partial` · **Notifications subsystem** — One home for the decision (event, audience, channels, preferences, read state) and in-app delivery, delegating external delivery to communications-layer ports; replaces per-feature trigger code.
  - `notifications.registry` · `shipped` · **Notification type registry** — Declarative types: key, category, internal/external audience, severity, mandatory flag, eligible channels with default routing, channel-aware templates, cadence, audited flag; fitness-function introspectable. _Note: Nine types registered; a type also declares the outbox topic it subscribes to, its subject kind, its matter anchoring, its non-privileged fact schema, and its email content level._
  - `notifications.recipients-preferences` · `partial` · **Recipients & preferences** — Recipient resolution to a firm member or Directory entity; per-user channel matrix on the settings scope chain; mandatory categories non-silenceable; external routing honors STOP/TCPA consent. _Note: The email detail level (a member's choice under a firm ceiling) is built ahead of the matrix, so a firm's stored ceiling is not rewritten when the digest ships._
  - `notifications.center` · `partial` · **In-app notification center** — Per-firm D1 rows (IDs + non-sensitive display fields, seen/read state, canonical deep-link) aggregated into the staff bell: unread badge, grouped/filterable list, mark-read, click-through. _Note: Backend only. The card is assembled at read time from the kind and a visibility-filtered matter join — no title, name, or filename is stored._
  - `notifications.channels` · `not-started` · **Delivery channels** — The channels a notification can route to — in-app, email, SMS, web push, desktop
    - `notifications.channels.email` · `not-started` · **Email channel** — External delivery via the communications layer: transactional provider for system/billing, matter mailbox for thread-bound mail.
    - `notifications.channels.sms` · `not-started` · **SMS/MMS channel** — Appointment/deadline/payment reminders through the messaging port where type and recipient warrant.
    - `notifications.channels.web-push` · `deferred` · **Web push channel** — Push API subscriptions + VAPID via the app-shell service worker.
    - `notifications.channels.desktop` · `deferred` · **Desktop-native notifications** — Native tray/notification presenter over the same rows, riding Tauri with the web center as fallback.
  - `notifications.raise-port` · `partial` · **notify() raise port & co-located raises** — Single raise port with high-value raises co-located on unbypassable paths (audit-log write for money/trust, task write path, conflicts/portal/deadline/job seams); fan-out off the hot path via Queues. _Note: There is deliberately no raise port for topics already on the outbox — the outbox row IS the emission, and a second row beside it would be a weaker copy of a guarantee that already holds. The comparison-shaped points (deadlines, custody reminders) and the job coordinators are the next sub-slice._
  - `notifications.scheduling` · `not-started` · **Scheduled reminders** — Cron-triggered Workflow sweeping due reminders per firm; deadline dates computed in the court's zone.
  - `notifications.digest` · `deferred` · **Digest rollup** — Cadence-based rollup of multiple items into one summary notification.
  - `notifications.freshness` · `partial` · **Freshness & delivery mechanics** — Durable rows plus refetch-on-focus, cross-tab BroadcastChannel invalidation, cheap unread-count poll; job-completion rides the per-job Durable Object channel. _Note: The poll also reports what the retention sweep took while unread, so a member returning from leave is told there is a gap rather than shown a zero._
    - `notifications.freshness.per-user-do-push` · `deferred` · **Per-user Durable Object push channel** — Real-time push per user extending the DO-per-job primitive, adoptable behind existing call sites.
  - `notifications.confidentiality` · `partial` · **Confidentiality & read-time enforcement** — External channels carry no privileged content (allowlist bodies, deep links); in-app visibility re-checks access at read time (stale rows filtered, never an existence oracle); rows firm- and recipient-scoped; audited dispatch for audited categories. _Note: The external-channel half lands with the email digest. Audited dispatch lands with the preference slice._

### Observability & Diagnostics

[`roadmap.d/observability.md`](../roadmap.d/observability.md) — 24 nodes, 46% shipped. 11 done, 5 part-built, 6 ahead, 2 parked.

- `observability` · `partial` · **Observability & diagnostics** — Diagnose without exfiltrating privileged content: redacted operational telemetry, user-initiated incidents, correlation IDs, usage analytics, status page; no third-party error SaaS, no session replay.
  - `observability.redaction-model` · `shipped` · **Redact-by-default event model** — Three data classes (metadata / opaque identifiers / content-never); allowlist event assembly with a boundary scrubbing pass.
  - `observability.correlation` · `shipped` · **Correlation & Error IDs** — Per-request correlation ID on every event and problem response; Error ID minted at capture joining a user-visible failure to its server trace.
  - `observability.operational-telemetry` · `shipped` · **Always-on operational telemetry** — Redacted structured server logs and counters (Workers logger + Analytics Engine), firm-scoped, keyed by correlation/Error ID. _Note: Logpush-to-R2 archival is account configuration, not verified in-repo._
  - `observability.client-reporter` · `partial` · **In-house client capture** — Svelte error boundary + global handlers, Error ID display, breadcrumb ring buffer, no third-party SDK.
    - `observability.client-reporter.error-boundary` · `shipped` · **Error pages with trace identity** — Error surfaces bake in build commit/mode/time plus browser line in a copyable trace block.
    - `observability.client-reporter.breadcrumbs` · `not-started` · **Client breadcrumb ring buffer** — Client-side ring of recent actions/IDs (never field content) attached to reports.
    - `observability.client-reporter.report-a-problem` · `partial` · **Report a problem affordance** — Always-available help-menu reporting usable without a crash.
    - `observability.client-reporter.send-to-developer` · `not-started` · **Send-to-developer on crash** — Error screen/toast showing the Error ID with a prominent send button.
  - `observability.incidents` · `partial` · **Incident reports** — User-initiated firm-scoped incident rows: Error IDs, redacted breadcrumbs, free-text description, context metadata; access-gated and audited.
    - `observability.incidents.ingest` · `shipped` · **Incident ingest endpoint** — POST incidents route writing a bounded, redacted-by-construction firm-scoped row; description sealed under the firm key with an audited decrypt permission.
    - `observability.incidents.screenshot` · `not-started` · **Opt-in redactable screenshot** — User-redactable screenshot attached to a report, stored in R2.
    - `observability.incidents.acknowledgement` · `not-started` · **Reporter acknowledgement loop** — Receipt and resolution status posted back to the reporter in-app/portal.
  - `observability.diagnostics-agent-pipeline` · `not-started` · **Diagnostics agent pipeline** — Queue from incident submission to an autonomous propose-only agent: triage, root-cause draft, draft PR, user acknowledgement.
  - `observability.diagnostics-setting` · `not-started` · **User-configurable diagnostics setting** — Per-firm setting with per-user override controlling whether/what-detail diagnostics send (off-strict / standard / verbose-auto beta posture).
  - `observability.analytics-tier` · `deferred` · **Telemetry analytics tier (Iceberg on R2)** — Logpush to Pipelines to R2 Data Catalog registering redacted cross-firm aggregate logs as Iceberg tables for DuckDB/Spark/BI at zero egress.
  - `observability.usage-analytics` · `partial` · **Product-usage analytics** — Content-free usage.feature events (reached/completed) with pseudonymous identifiers, opt-out consent, and cross-firm aggregate queries.
    - `observability.usage-analytics.server-events` · `shipped` · **Server-side reached/completed events** — Route-to-feature middleware for reached; outbox sweep topic-to-feature for completed; versioned feature taxonomy.
    - `observability.usage-analytics.pseudonymization` · `shipped` · **HMAC pseudonymization** — firmId/userId HMAC-pseudonymized under a server pepper before write; missing pepper drops the event (fail-closed).
    - `observability.usage-analytics.consent` · `shipped` · **Usage-analytics consent resolution** — Firm-level enable (default on) with per-member opt-out, resolved off the hot path via a cached resolver.
    - `observability.usage-analytics.aggregate-queries` · `shipped` · **Aggregate queries with small-n suppression** — Cross-firm aggregate-only queries, k=5 suppression with suppressed counts reported separately; canonical query set.
    - `observability.usage-analytics.client-beacon` · `deferred` · **Client beacon** — Client-emitted reached events for pure-client surfaces with no server round-trip.
  - `observability.status-page` · `shipped` · **Public service status page** — Isolated status Worker (KV-only) rendering zero-JS server-side HTML: live snapshot, 90-day per-component uptime history, upstream-provider advisories, subscribe panel. _Note: Deploy-activation checklist (status.magnacarta.esq) still pending per status.d/service-status.md._
  - `observability.support-access` · `shipped` · **Audited support access** — Pull-not-push help-desk access: time-boxed audited support_grant, diagnostic vs privileged-self tiers. _Note: Dormant until platform_staff is seeded; UI deferred._

### Payments

[`roadmap.d/payments.md`](../roadmap.d/payments.md) — 9 nodes, 0% shipped. 0 done, 0 part-built, 9 ahead, 0 parked.

- `payments` · `not-started` · **Payments** — Payment acceptance as a swappable-adapter port, ACH-default with card fallback, structured so processor fees never touch trust.
  - `payments.port` · `not-started` · **Payments port** — Vendor-swappable payments adapter behind the plugin/port system.
  - `payments.ach` · `not-started` · **ACH rail (default)** — Bank-transfer rail presented as the default, prominent option with small flat/capped fees.
  - `payments.card` · `not-started` · **Card rail (fallback)** — Card acceptance as the convenience fallback.
  - `payments.trust-separation` · `not-started` · **Fees never touch trust** — Trust/IOLTA deposits land gross; card fees debit operating only, enforced by separate deposit destinations per rail.
  - `payments.surcharge` · `not-started` · **Operating-only surcharge** — Optional card surcharge/convenience fee on operating (never trust) payments, gated by jurisdiction config; debit never surcharged.
  - `payments.helcim` · `not-started` · **Helcim launch adapter** — Launch adapter covering both rails — interchange-plus cards and capped-fee ACH.
  - `payments.pci-scope` · `designed` · **PCI scope minimization** — Card capture exclusively via the processor's hosted payment modal returning a cardToken; store token plus last-four/brand only; script-clean payment page; SAQ A.
  - `payments.alternate-adapters` · `not-started` · **Alternate adapter seams** — Stripe/Dwolla for cheaper ACH at scale, Adyen for high card volume, Confido/Gravity Legal as trust-compliance fallback.

### Performance & Concurrency

[`roadmap.d/performance.md`](../roadmap.d/performance.md) — 13 nodes, 46% shipped. 6 done, 4 part-built, 1 ahead, 2 parked.

- `performance` · `partial` · **Performance & concurrency model** — Deliberate compute placement (Workers / Containers+Queues / Durable Objects / Rust core / browser / desktop) plus a measure-first discipline against the load-profile harness.
  - `performance.compute-placement` · `partial` · **Compute-placement model** — Each unit of work assigned to its tier; concurrency lives in the platform, not hand-threaded Workers.
    - `performance.compute-placement.lean-workers` · `shipped` · **Lean streaming request handlers** — Latency-sensitive CRUD/orchestration only in Workers; large data streamed, never buffered.
    - `performance.compute-placement.containers-queues` · `shipped` · **Heavy work in Containers via Queues** — OCR, indexing, generation, conversion, extraction as native Rust/containers fanned out through Queues with a Durable Object per job.
    - `performance.compute-placement.sandbox-hardening` · `shipped` · **Untrusted-input sandbox hardening** — No-egress, least-privilege-per-job, ephemeral, resource-capped containers for native parsers over untrusted files; assume-escape posture.
    - `performance.compute-placement.durable-object-coordination` · `shipped` · **Durable Object stateful coordination** — Single-threaded DOs for correctness/serialization: live timers, job orchestration, per-firm database access.
    - `performance.compute-placement.rust-core` · `shipped` · **Shared Rust core (WASM + native)** — Compute-heavy parity features as one Rust core compiled to WASM for web and native for desktop/containers.
    - `performance.compute-placement.browser` · `partial` · **Browser main-thread discipline** — Web Workers for CPU-bound work, virtualization for large lists, per-route code-splitting, no client-data caching.
    - `performance.compute-placement.desktop` · `deferred` · **Desktop local accelerations** — Multi-threaded Rust in the Tauri shell for bulk ingest, local OCR, local Tantivy index — optional, with server fallback.
  - `performance.resource-discipline` · `partial` · **Resource discipline defaults** — Stream not buffer, paginate, batch/join in the data-access layer (no N+1), bounded Worker memory and queue concurrency; enforced in review.
  - `performance.load-profile-harness` · `shipped` · **Load-profile harness** — Volume profiles plus a query measurement runner over the synthetic fixtures; every domain slice extends it in-area.
  - `performance.budgets-ci-gates` · `deferred` · **Per-tier budgets & CI performance gates** — Concrete numeric budgets and CI perf gates over the harness.
  - `performance.wasm-promotion` · `not-started` · **Profiling-gated Rust-WASM promotion** — Hot-path client logic promoted to the Rust/WASM core only on profiling evidence from the harness.

### Platform — Delivery, Architecture, Tenancy & Data Conventions

[`roadmap.d/platform.md`](../roadmap.d/platform.md) — 82 nodes, 37% shipped. 30 done, 22 part-built, 23 ahead, 7 parked.

- `platform` · `partial` · **Platform** — Delivery model, application architecture, architectural coherence, tenancy and isolation, Cloudflare primitive adoption, and the foundational data and runtime conventions. _Note: Backend foundations largely shipped; web UI shell in build; desktop not started._
  - `platform.workers-api` · `partial` · **Workers REST API** — Cloudflare Workers backend on Hono exposing a REST API documented by OpenAPI 3.1. _Note: First-party same-origin /api surface live; the public token-auth host is reserved, not built._
    - `platform.workers-api.code-as-contract` · `shipped` · **Code-as-contract OpenAPI** — Each endpoint defined once with zod via @hono/zod-openapi, deriving the typed client and the emitted OpenAPI 3.1 spec.
    - `platform.workers-api.contract-toolchain` · `shipped` · **Spec CI toolchain** — Spectral linting, Prism mock smoke, oasdiff breaking-change detection, and snapshot drift gates over the emitted spec. _Note: Spectral duplicated-entry-in-enum rule disabled (crash on null-valued extensions), recorded as an ADR-0066 amendment._
    - `platform.workers-api.typed-client` · `shipped` · **Generated typed client** — Committed Hey API plus Svelte Query v6 client generated from the emitted spec, operationId-keyed factories.
    - `platform.workers-api.route-chokepoint` · `shipped` · **Route metadata chokepoint** — Ordered enforcement chain (tenancy, authn, RBAC, idempotency, rate limit) driven by per-route declared metadata, with a conformance fitness suite.
    - `platform.workers-api.public-api-host` · `not-started` · **Public API host** — api.magnacarta.esq token-authenticated third-party/SDK surface, separated from cookie-auth first-party calls by host. _Note: Host reserved by design; only the same-origin first-party surface exists._
    - `platform.workers-api.service-bindings` · `shipped` · **Internal Worker RPC** — Plugin/core and heavy-service calls over Cloudflare service bindings, separate from the public REST surface.
  - `platform.web-spa` · `partial` · **Web SPA** — Svelte 5 / SvelteKit SPA (adapter-cloudflare) served as Workers static assets, login-gated, per-route code-splitting. _Note: Skeleton shipped; app shell and first operable surfaces in build on branch slice-0-7b-app-shell._
    - `platform.web-spa.app-shell` · `in-build` · **App shell and first surfaces** — Authenticated application shell, navigation, settings surfaces, matter and tools views.
    - `platform.web-spa.multi-tab-sync` · `not-started` · **Cross-tab state sync** — BroadcastChannel cache-invalidation broadcast so an edit in one tab updates other tabs and windows.
    - `platform.web-spa.popout-windows` · `not-started` · **Pop-out windows** — Optional pop-out windows for documents and matters with coherent state.
    - `platform.web-spa.app-shell-caching` · `not-started` · **Service-worker asset cache** — Service worker caches app shell/assets only, no client-data caching, cleared on logout; web app deliberately not an installable PWA.
    - `platform.web-spa.public-surfaces` · `not-started` · **Public web surfaces** — Marketing site, help center, public intake forms, product-updates pages rendered separately (static/SSR) for SEO. _Note: Crawler directives for private surfaces exist (apps/worker/src/crawler-directives.ts); the public sites themselves do not._
  - `platform.desktop` · `not-started` · **Tauri desktop shell** — Tauri 2 shell reusing the identical Svelte bundle and Workers API, shipped after the web MVP.
    - `platform.desktop.parity` · `not-started` · **Web/desktop parity policy** — No platform-exclusive features; desktop adds only optional local accelerations with a complete server/web fallback. _Note: Policy accepted; nothing to enforce until the desktop build begins. Scanning parity framing revised to MFP-receiving plus LAN bridge._
    - `platform.desktop.local-accelerations` · `not-started` · **Desktop local accelerations** — Local bulk ingest, on-device OCR (same engine/models), local Tantivy index, OS keychain, native filesystem and notifications.
    - `platform.desktop.offline-sync` · `not-started` · **Desktop offline and sync** — On-disk cache persister plus a durable outbound mutation queue replayed on reconnect.
  - `platform.rust-core` · `partial` · **Rust shared core** — Rust used surgically — server engines in Containers, scoped shared cores compiled to WASM for web/Workers and native for desktop. _Note: PDF/email/OCR/decryption/recovery cores and the engine-host seam built; Tantivy search and the document-generation merge engine not started (Discovery and Documents areas)._
  - `platform.scan-capture` · `partial` · **Inbound capture (scan-to-matter)** — MFP/copier scanning treated as a receiving-plus-routing problem: Magna Carta as a destination for scan-to-email/eSCL/WSD, never per-vendor panel apps as core. _Note: Named in the white paper as needing its own subsystem spec; only the source-agnostic ingest substrate exists._
    - `platform.scan-capture.ingest-chokepoint` · `shipped` · **Source-agnostic ingest pipeline** — One staged/quarantine incoming pipeline (scan verdict, staff-accept onto a matter) shared by uploads and future scan/email sources.
    - `platform.scan-capture.inbound-email` · `designed` · **Inbound email capture** — Receiving scan-to-email / inbound mail on Cloudflare via an Email Worker into the ingest pipeline (25 MiB ceiling noted).
    - `platform.scan-capture.matter-routing` · `not-started` · **Inbound matter routing** — Routing model for inbound captures: firm-wide intake queue, barcode/QR cover-sheet auto-filing, per-matter intake aliases.
    - `platform.scan-capture.desktop-lan-bridge` · `deferred` · **Desktop LAN scanner bridge** — Desktop-attached scanner (TWAIN/eSCL) and on-LAN MFP bridge protocol set (eSCL/WSD/SMB/WebDAV terminating on desktop). _Note: Explicitly deferred to the build in the white paper, alongside the large-scan fallback._
    - `platform.scan-capture.vendor-panel-apps` · `deferred` · **Per-vendor MFP panel apps** — Apps on vendor firmware platforms (MEAP, EIP, ESA, OXP, OSA, eSF, HyPAS). _Note: Rejected up front as core (unbounded per-vendor integration tax); optional single-dominant-device app deferred._
  - `platform.url-navigation` · `partial` · **URL and navigation architecture** — Real deep-linkable permalink per view; matter-number canonical URLs over immutable opaque handles; path=addressable state, query=refinement.
    - `platform.url-navigation.matter-number-urls` · `partial` · **Matter-number URL scheme** — Canonical human-facing matter-number URL, firm-configurable (opaque option), sealed matters force-opaque, firm-bound resolution. _Note: Backend numbering shipped; configurable scheme/forced-opaque URL behavior awaits the web matter surface._
    - `platform.url-navigation.alias-redirects` · `not-started` · **Renumbering alias redirects** — Prior matter numbers kept as aliases that 301-redirect to the current canonical URL; opaque handle always resolves.
    - `platform.url-navigation.reserved-namespace` · `not-started` · **Reserved route namespace** — Maintained reserved list of top-level host and path names so user-influenced segments cannot shadow system routes.
    - `platform.url-navigation.host-separation` · `partial` · **Host and auth-model separation** — app/api/portal/marketing hosts; firm resolved from session never the address; cookie auth same-origin vs token auth by host. _Note: First-party host + session-resolved firm shipped; api. and portal. hosts not stood up._
    - `platform.url-navigation.custom-domains` · `deferred` · **White-label custom domains** — Cloudflare for SaaS custom-domain seam (app.firm.com to firm lookup); per-firm vanity subdomains rejected. _Note: Shaped but deferred in the white paper._
  - `platform.client-state` · `partial` · **Client data and state architecture** — Three-way state split with one owner each: URL state in the router, server state in TanStack Query v6, local/UI state in Svelte 5 runes.
    - `platform.client-state.server-state-query` · `partial` · **Server-state caching layer** — TanStack Query caching, dedup, refetch-on-focus, optimistic mutations with rollback surfacing the Error ID, keys derived from the contract client. _Note: Factories shipped; app-wide adoption rides the 0-7b shell build._
    - `platform.client-state.live-job-channels` · `shipped` · **Per-feature live channels** — Durable-Object-backed channels only where needed: long-running job progress and the cross-device live timer.
    - `platform.client-state.global-server-push` · `deferred` · **Global server-push layer** — Per-matter/per-firm push channel extending the DO-channel primitive. _Note: Explicitly rejected for v1, kept as a seam._
    - `platform.client-state.local-first-sync` · `cut` · **Local-first sync engine** — Full client sync engine (TanStack DB / Zero / Triplit class). _Note: Rejected as the default (fights the server-authoritative ledger and per-firm isolation); kept only as a seam._
  - `platform.architectural-integrity` · `partial` · **Architectural integrity and coherence** — Coherence engineered as a property of the codebase: prevent structurally, fail loudly in CI, make the right thing discoverable.
    - `platform.architectural-integrity.chokepoint-seams` · `shipped` · **Chokepoint seams** — Cross-cutting concerns as properties of a mandatory path: firm-scoped data access, protected() fields, audit-on-write, outbox-on-effect.
    - `platform.architectural-integrity.registry-first` · `shipped` · **Registry-first pattern** — Growing categories as declarative registries: permissions, identifier prefixes, protected fields, settings, conversion formats, tools catalog, flags.
    - `platform.architectural-integrity.fitness-functions` · `partial` · **Architectural fitness functions** — CI checks over the architecture itself: boundary/dependency rules, custom lint, conformance tests over registries and the OpenAPI contract, LLM tier. _Note: Deterministic tiers shipped piecemeal per area; the propose-only LLM-as-fitness-function tier is not built (docs-sync agent exists for docs, not architecture)._
    - `platform.architectural-integrity.capability-indexes` · `not-started` · **Generated read-first indexes** — Capability map generated from registries and module surfaces, regenerated in CI with fail-on-drift, surfaced by area CLAUDE.md files.
    - `platform.architectural-integrity.spec-plan-workflow` · `shipped` · **Spec-plan-execute continuity** — Per-slice written designs and plans persisted in the repo so sessions resume from the plan.
  - `platform.tenancy` · `partial` · **Tenancy and data isolation** — Three tiers: control-plane D1 (identity, firm registry), per-firm database, per-firm R2 bucket; firm is the unit of tenancy.
    - `platform.tenancy.control-plane` · `shipped` · **Control-plane database** — Central D1 holding credentials, sessions, the single firm_id per user, and the firm registry; no client or matter content.
    - `platform.tenancy.per-firm-database` · `shipped` · **Per-firm database** — Per-firm structured business data in an isolated database. _Note: Realized as a firmId-addressed FirmDatabase SQLite Durable Object, superseding the per-firm-D1 half of the original decision._
    - `platform.tenancy.per-firm-bucket` · `shipped` · **Per-firm R2 bucket** — Per-firm versioned file storage; bulk content always to R2, never the database.
    - `platform.tenancy.firm-scoped-dal` · `shipped` · **Firm-scoped data-access layer** — All business data through the firm-scoped data-access layer; no query crosses firms.
    - `platform.tenancy.member-mirror` · `shipped` · **Member mirror sync** — Per-firm member table mirroring the firm's users by global user_id (role, location, rate, display identity); provision/deactivate writes both places.
    - `platform.tenancy.locations-dimension` · `shipped` · **Locations inside the firm** — Offices as a first-class dimension inside the per-firm database, never a separate tenant; firm-wide Directory and conflicts.
    - `platform.tenancy.firm-provisioning` · `shipped` · **Firm provisioning** — Idempotent, resumable firm resource provisioning behind a provider port (pool claim now, REST adapter for real D1/R2).
    - `platform.tenancy.backup-dr` · `partial` · **Backup and disaster recovery** — Two layers: platform point-in-time recovery for operational mistakes, plus exported snapshots for long-term and disaster recovery.
      - `platform.tenancy.backup-dr.time-travel` · `shipped` · **Point-in-time recovery layer** — D1 Time Travel 30-day any-minute restore, no setup. _Note: Platform-provided for the control-plane D1; per-firm data now lives in the FirmDatabase Durable Object (ADR-0140), whose PITR story should be re-verified against this promise._
      - `platform.tenancy.backup-dr.export-snapshots` · `not-started` · **Export snapshots** — Cron-triggered Workflow fanning out across firms, streaming zstd-compressed SQL dumps into each firm's R2 under backups/, control plane included; restore drills.
      - `platform.tenancy.backup-dr.gfs-retention` · `not-started` · **GFS retention tiering** — Daily 30d, weekly 1y, monthly/yearly 7+ years; aged snapshots tier to Infrequent Access.
      - `platform.tenancy.backup-dr.bucket-locks` · `not-started` · **Backup immutability locks** — Prefix-scoped R2 bucket-lock retention rules per GFS tier so snapshots cannot be deleted before aging out.
      - `platform.tenancy.backup-dr.offsite-export` · `deferred` · **Off-Cloudflare export** — Off-Cloudflare export seam for account-loss/catastrophe/certified-WORM tail. _Note: Explicitly designed-but-deferred in the white paper._
  - `platform.primitives` · `partial` · **Cloudflare primitive adoption** — The mapped platform primitives actually in use beyond Workers/D1/R2 (covered by other nodes).
    - `platform.primitives.durable-objects` · `shipped` · **Durable Objects** — Live collaboration/state and container control: FirmDatabase, live timer, bulk-download jobs, per-document edit sessions.
    - `platform.primitives.queues` · `shipped` · **Queues** — Async work: file ingest, member provisioning, outbox relay delivery, per-firm consumers.
    - `platform.primitives.containers` · `shipped` · **Containers** — Heavy services in Containers: Collabora editing, malware scan, OCR, raster conversion, bundling, recovery, file repair. _Note: LibreOffice headless from the original mapping superseded by the in-house-only conversion decision (ADR-0116); Tantivy container not started (Discovery phase)._
    - `platform.primitives.vectorize` · `not-started` · **Vectorize semantic search** — Semantic search over Vectorize. _Note: Rides the Discovery phase._
    - `platform.primitives.kv` · `shipped` · **KV cache/config** — KV for cache and config surfaces.
    - `platform.primitives.worker-secrets` · `shipped` · **Worker secrets anchors** — Root KEK, session-signing, transactional-email and admin keys as Worker secrets with a required-secrets deploy gate.
    - `platform.primitives.telemetry` · `shipped` · **Telemetry pipeline** — Workers Logs / Analytics Engine telemetry with structural redaction, correlation ids, and Error IDs.
  - `platform.time-model` · `partial` · **Time, dates and timezones** — Time modeled by kind — UTC instants, civil dates plus jurisdiction zone, wall-clock recurrences, durations — on the Temporal API. _Note: Convention decided and applied in schemas; no Temporal-based formatting layer or storage fitness function in the tree yet._
    - `platform.time-model.zone-context` · `not-started` · **Zone context homes** — IANA zone on each Location supplying default matter jurisdiction; per-user display-zone preference.
    - `platform.time-model.rendering-enforcement` · `not-started` · **Zone rendering enforcement** — Single UI formatting layer rendering in an explicit zone plus a fitness function forbidding naive local datetimes in storage.
  - `platform.durability-on-close` · `partial` · **Durability on close** — No graceful close ever trusted: acknowledged writes durable, replay safe, close/logout guards flush-first, autosaved server-side drafts.
    - `platform.durability-on-close.server-durability` · `shipped` · **Server-side durability** — Idempotent replay, outbox, DO durable storage for timer/job state, at-least-once queues with idempotent consumers.
    - `platform.durability-on-close.client-guard` · `not-started` · **Shared close/logout guard** — One shared client primitive for beforeunload/close-requested flush-then-warn; logout cache-clear gated on drained queue. _Note: Awaits the web app shell; numbers (flush/checkpoint intervals) deferred to the build by design._
    - `platform.durability-on-close.draft-autosave` · `not-started` · **Server-side draft autosave** — Editor and form input autosaved as server-side drafts on an interval.
  - `platform.money` · `partial` · **Money and currency** — Integer minor units only (amounts at 2 dp, rates at 4 dp), ISO-4217 tag, Dinero.js v2 bigint behind an in-house money module seam.
    - `platform.money.rounding-helpers` · `shipped` · **Boundary-named rounding** — Intent-named helpers: tax half-up, invoice-line half-up, GL banker's, splits largest-remainder; no silent default mode.
    - `platform.money.multi-currency` · `deferred` · **Multi-currency / FX** — FX machinery beyond the carried currency field. _Note: Field exists so multi-currency is a later evolution; explicitly not built (design for the superset, ship the subset)._
  - `platform.identifiers` · `shipped` · **Identifier strategy** — Type-prefixed CSPRNG-random URL-safe handle as the single primary key; ~126-bit guess-resistance; time-encoded ids rejected.
  - `platform.idempotency` · `shipped` · **Idempotency** — Client-generated Idempotency-Key on every mutation; same-key replay, in-progress 409, fingerprint-mismatch 422; row and effect commit atomically. _Note: Per-route required/optional declaration enforced by the conformance suite; TTL purge cron wired._
  - `platform.outbox` · `partial` · **Transactional outbox** — Effects recorded as outbox rows in the same transaction as the business change; relay publishes to Queues; idempotent consumers; dead-letter to observability.
    - `platform.outbox.saga-workflows` · `not-started` · **Sagas via Workflows** — Multi-step external flows composed as Workflows with compensating actions on the outbox + idempotency primitives. _Note: Decision accepted; no Workflow entrypoint in the tree yet._
  - `platform.schema-migration` · `partial` · **Schema migration and the fleet** — Drizzle single source for types and migrations, two lineages, fleet rollout with per-firm isolation, expand-contract discipline.
    - `platform.schema-migration.fleet-runner` · `shipped` · **Fleet rollout orchestrator** — Bounded-concurrency fan-out applying pending per-firm migrations, quarantine on failure, idempotent resume, version recorded in the firm registry.
    - `platform.schema-migration.control-plane-applier` · `shipped` · **Control-plane auto-applier** — Automatic application of control-plane migrations on deploy.
    - `platform.schema-migration.monotonic-ids` · `in-build` · **Monotonic migration ids** — Collision-proof migration numbering across parallel branches.

### Client Portal

[`roadmap.d/portal.md`](../roadmap.d/portal.md) — 16 nodes, 0% shipped. 0 done, 0 part-built, 15 ahead, 1 parked.

- `portal` · `not-started` · **Client portal** — External-facing surface for clients, co-counsel, experts, and other Directory contacts — document sharing, invoice viewing/payment, secure messaging, e-signature, bug reporting. _Note: Recipients are always Directory entities (no shadow user list); Directory is shipped._
  - `portal.grant-model` · `not-started` · **Unified PortalGrant model** — One first-class grant record per share (matter/folder/file scope) carrying recipient, capability set, assurance level, expiry, status, and audit fields.
  - `portal.scopes` · `not-started` · **Scope semantics** — File scope with optional version pin; folder scope live but child-folders private until shared; matter scope as sugar over shareable folders; shareability visible in the File Manager.
  - `portal.capabilities` · `not-started` · **Per-grant capabilities** — view, download, upload, comment/message, and esign as a per-grant subset.
    - `portal.capabilities.view` · `not-started` · **Inline view** — View-only access through the inline preview viewer behind portal auth.
    - `portal.capabilities.download` · `not-started` · **Download** — Streaming-zip bulk download reused behind portal auth.
    - `portal.capabilities.upload` · `not-started` · **Upload with quarantine** — Recipient uploads quarantine into a staff-reviewed incoming queue with full ingest treatment and staff acceptance.
    - `portal.capabilities.messaging` · `not-started` · **Secure messaging** — Comment/message capability threaded on the matter record.
    - `portal.capabilities.esign` · `not-started` · **Portal e-signature** — esign capability delivered through the e-signature area.
  - `portal.identity` · `not-started` · **Identity and per-share assurance** — Magic-link, account (email OTP), and account+2FA assurance levels; portal accounts as a distinct external principal type in control-plane D1 linked to Directory entities.
  - `portal.lifecycle` · `not-started` · **Grant lifecycle** — Instant revocation, optional expiry with auto-transition, and full metadata-only audit of grant events and access.
  - `portal.enforcement` · `not-started` · **DAL enforcement and invariants** — Per-firm isolation, ethical-wall/least-privilege bound (grant never exceeds sharer's access), enforced in the firm-scoped data-access layer.
  - `portal.ui` · `not-started` · **Recipient-facing portal UI** — Aggregated portal rendering the live union of a recipient's active grants.
  - `portal.invoices` · `not-started` · **Invoice viewing and payment** — Recipients view invoices and pay them through the Payments rails.
  - `portal.bug-reporting` · `not-started` · **Portal bug reporting** — External users report bugs under the same redact-by-default pipeline as staff.
  - `portal.deferred` · `deferred` · **Deferred portal items** — Per-recipient watermarking, ad-hoc non-Directory email recipients, per-file exclusions within a shared folder.

### Product Updates & User-Facing Documentation

[`roadmap.d/product-updates.md`](../roadmap.d/product-updates.md) — 16 nodes, 13% shipped. 2 done, 4 part-built, 10 ahead, 0 parked.

- `product-updates` · `partial` · **Product updates** — In-app and public changelog, release notes, roadmap, and live known-issues/status — versioned content bundled with the build, live content in control-plane KV.
  - `product-updates.sources` · `shipped` · **Authoring homes and fragment assembly** — CHANGELOG.md and ROADMAP.md as the single authoring homes, fed by fragment directories assembled on main; propose-only docs-maintenance agent drafts entries.
  - `product-updates.artifact` · `not-started` · **Structured product-updates artifact** — Build step deriving product-updates.json (semver entries, categories, release-note highlights, roadmap items) from the markdown homes; malformed input fails CI; published to KV at deploy.
  - `product-updates.release-notes` · `not-started` · **Curated release notes** — Curated highlights maintained with the changelog and surfaced in What's New.
  - `product-updates.updates-route` · `not-started` · **In-app /updates surface** — Authenticated deep-linkable route with What's New, Changelog, and Roadmap tabs plus a help-menu entry carrying the unread badge.
  - `product-updates.public-pages` · `not-started` · **Public changelog/roadmap/status pages** — Logged-out Workers static pages rendered from the published artifact and KV status, presentation identical to in-app.
  - `product-updates.known-issues` · `partial` · **Live known issues / status** — Incident/known-issue content in control-plane KV, written through an owner/admin RBAC-gated endpoint (and propose-only agents), read by an in-app banner with no deploy. _Note: The status page/worker itself is owned by observability; this node covers the product-updates read of the same KV source._
  - `product-updates.unread-marker` · `not-started` · **What's New unread badge** — lastSeenProductUpdate identity-level preference in the Settings framework driving a client-side unread badge.
  - `product-updates.audience-seam` · `not-started` · **Roadmap audience field** — Optional audience field reserved in the artifact schema so an internal/public roadmap filter switches on at multi-firm.
  - `product-updates.forum-seams` · `not-started` · **Forum integration seams** — SSO deep-links into the community board, optional read-only vote counts on roadmap items, and the escalation bridge.
- `user-docs` · `partial` · **User-facing documentation** — Public help center, in-app contextual help, and separate admin docs, maintained in the same commit as the feature.
  - `user-docs.help-center` · `not-started` · **Public help center** — SEO-friendly help center served as Workers static assets.
  - `user-docs.in-app-help` · `not-started` · **In-app contextual help** — Contextual help surfaced inside the application.
  - `user-docs.admin-docs` · `not-started` · **Admin documentation** — Separate administration docs for the firm owner.
  - `user-docs.feature-guides` · `partial` · **Per-feature user guides** — End-user guides per shipped feature under docs/user/features/.
  - `user-docs.same-commit-rule` · `shipped` · **Docs-with-code maintenance rule** — User docs change in the same commit as the feature, audited by the docs-sync routine.

### Release Channels

[`roadmap.d/release-channels.md`](../roadmap.d/release-channels.md) — 9 nodes, 78% shipped. 7 done, 1 part-built, 1 ahead, 0 parked.

- `release-channels` · `partial` · **Release channels** — Firm-level stable/beta/alpha channels gating behavior (never schema) through feature flags, with consent-gated self-serve beta and developer-only alpha.
  - `release-channels.firm-channel` · `shipped` · **firm.release_channel model** — One control-plane column, values stable/beta/alpha with alpha superset nesting; channel is a firm property, never per-user; default stable.
  - `release-channels.schema-invariant` · `shipped` · **Channels gate behavior, not schema** — One fleet schema (additive, dark-shipped columns); flags flip exposure; migration runner marches every firm regardless of channel.
  - `release-channels.beta-door` · `shipped` · **Beta door (firm self-serve)** — Firm endpoint accepting only stable/beta, behind firm:manageReleaseChannel, requiring an explicit versioned consent acknowledgment recorded in the per-firm audit log.
  - `release-channels.alpha-door` · `shipped` · **Alpha door (developer-only)** — Secret-guarded platform endpoint writing any channel including alpha; audited in control-plane auth_audit; internal firms pinned to alpha for dogfooding.
  - `release-channels.feature-flags` · `shipped` · **Feature-flag engine (@magna-carta/feature-flags)** — Thin wrapper over the Cloudflare Flagship binding: evaluation-context construction, safe-default enforcement, FLAG_CATALOG with per-entry stage; test-substitutable fake.
  - `release-channels.fail-safe-defaults` · `shipped` · **Fail-safe flag defaults** — Every evaluation defaults to stable behavior; missing binding or flag outage resolves all-off automatically (Miniflare test pool included).
  - `release-channels.spa-delivery` · `shipped` · **Session & SPA flag delivery** — Per-request evaluation context (firmId, channel, role, userId — non-privileged identifiers only); resolved flag set delivered in the /me bootstrap beside permissions; one bundle for all channels.
  - `release-channels.frontend` · `planned` · **Channel frontend (Plan 2)** — Settings surface for the beta opt-in/consent flow plus stage-labeled Alpha/Beta markers and feedback affordances on pre-stable features, disappearing on graduation. _Note: Maturity-stage badges already render on the Tools listing page; the channel-driven marker system is not built._

### Reports

[`roadmap.d/reports.md`](../roadmap.d/reports.md) — 11 nodes, 9% shipped. 1 done, 2 part-built, 6 ahead, 2 parked.

- `reports` · `partial` · **Reports** — Reproducible projections over the append-only ledger; standard library of trust-compliance, financial, productivity, and operational reports with scheduling and exports. _Note: Owner scoped all four families with the bar-audit pack first; nine questions flagged for the owner in the design._
  - `reports.projections` · `shipped` · **Ledger projections** — Reports computed as projections over the append-only ledger, consistent with the books and reproducible for any past date. _Note: Backend only, no screen. Two blocks in the trust-compliance pack are labelled as outside the claim — the three-way proof beside each attestation, and the outstanding-item, unmatched-line and stored-balance checks — because their owning reads take no knowledge instant and a second definition of them is refused._
  - `reports.trust-compliance` · `partial` · **Trust-compliance reports** — Mandatory three-way reconciliation, client ledgers, and journal, per trust account. _Note: Backend only, no screen, and no filed artifact — turning a pack into an immutable firm document waits on a renderer this repository cannot run yet._
  - `reports.financial` · `planned` · **Financial reports** — WIP, A/R aging, realization, and profitability reports. _Note: Profitability is deferred — no timekeeper cost rate exists in the schema; work in progress is live-only because its stores are mutable and carry no billed_at/voided_at._
  - `reports.productivity` · `planned` · **Productivity reports** — Timekeeper and staff productivity reporting. _Note: Live-only (mutable store); no attainment figure, because the platform stores no billable-hour target._
  - `reports.operational` · `planned` · **Operational reports** — Operational reporting over firm activity.
  - `reports.location-rollups` · `planned` · **Per-location roll-ups** — Financial and productivity reports filter and subtotal by office; trust reports inherently per-account/per-location.
  - `reports.scheduling` · `planned` · **Scheduled generation** — Scheduled/automated report generation, archival, and optional email delivery.
  - `reports.exports` · `planned` · **Exports** — PDF, Excel/CSV, and print export of reports.
  - `reports.custom-builder` · `deferred` · **Custom report builder** — User-defined custom reports.
  - `reports.dashboards` · `deferred` · **Live dashboards** — Live operational/financial dashboards.

### Settings & Configuration

[`roadmap.d/settings.md`](../roadmap.d/settings.md) — 17 nodes, 24% shipped. 4 done, 9 part-built, 4 ahead, 0 parked.

- `settings` · `partial` · **Settings & configuration framework** — Declarative settings registry, scope-chain resolution, role-gated access enforced in the data-access layer, storage placement per tenancy, and the registry-driven Settings area.
  - `settings.registry` · `partial` · **Declarative settings registry** — Each setting declared once (key, type, scope, default, access, validation, audited/effective-dated flags).
    - `settings.registry.backend-definitions` · `shipped` · **Backend firm-setting definitions** — Per-package setting definitions with validated write paths and total reads (safe defaults).
    - `settings.registry.generated-ui` · `partial` · **Registry-generated settings pages** — One renderer generating pages from the registry — a standard page is a registry entry plus definitions.
  - `settings.scope-resolution` · `shipped` · **Scope chain resolution** — Most-specific-wins precedence: entity override, user, location, firm default, system default; settings opt into scopes.
  - `settings.access-rbac` · `partial` · **Per-setting view/edit access** — Role required to view and to edit each setting, enforced server-side in the firm-scoped data-access layer, mirrored in the UI.
  - `settings.storage-placement` · `shipped` · **Storage placement (no duplication)** — Identity prefs on the control plane, per-user firm-scoped prefs on the member row, firm business settings in per-firm D1; framework registers data subsystems own.
  - `settings.change-discipline` · `partial` · **Audited & effective-dated changes** — Settings writes through the data-access layer; financial/security/firm settings audited; effective-dated where it matters.
  - `settings.area-ui` · `partial` · **The Settings area** — Banded settings navigation (My / Firm / Platform), posture badges, draft staging with confirmation recap, change-history pull-out, command-palette listing.
    - `settings.area-ui.my-account` · `partial` · **My Account (identity & security)** — Person-scoped /account secure shell: profile (name, email, avatar) and security (password, 2FA, sessions), no app chrome.
    - `settings.area-ui.personal-preferences` · `shipped` · **Personal preferences (Theme, Accessibility, Text)** — Apply-immediately user settings with cross-tab sync; real end-to-end High Contrast axis.
    - `settings.area-ui.firm-band` · `partial` · **Firm settings band** — Firm Profile, Users, Matter Numbering, Billing, File Safety & Scanning as staged draft pages with Save/Cancel commit flow.
    - `settings.area-ui.platform-band` · `partial` · **Platform band (Beta Access, Versions, Developer)** — Firm release-channel stance, versioned-component ledger, developer master switch and console.
    - `settings.area-ui.integrations-category` · `not-started` · **Integrations settings category** — Plugin credential management UI per firm.
    - `settings.area-ui.diagnostics-category` · `not-started` · **Diagnostics settings category** — UI for the diagnostics consent/level setting.
    - `settings.area-ui.notifications-category` · `not-started` · **Notification preferences category** — Per-user type/category-by-channel routing matrix with locked mandatory categories.
    - `settings.area-ui.documents-templates-category` · `not-started` · **Documents & templates category** — Settings surface for document types and templates.

### Tasks and Workflows / Matter Plans

[`roadmap.d/tasks.md`](../roadmap.d/tasks.md) — 4 nodes, 0% shipped. 0 done, 0 part-built, 4 ahead, 0 parked.

- `tasks` · `not-started` · **Tasks and workflows** — Task lists with assignments and due dates, plus templated matter plans auto-instantiated per matter type.
  - `tasks.task-lists` · `not-started` · **Task lists** — Tasks with assignments and due dates on matters.
  - `tasks.matter-plans` · `not-started` · **Matter plans** — Templated task/event/document sequences per matter type, auto-instantiated when a matter opens; pairs with document automation and the calendar.
  - `tasks.workflow-model` · `researching` · **Workflow model** — Template authoring, task dependencies/sequencing, assignment and reassignment, due-date derivation (including from docketing), notification/escalation, completion tracking.
