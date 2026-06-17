# Email filing &amp; capture — design (subsystem)

**Status:** Draft — in progress (brainstorm capture; not yet Accepted) · **Date:** 2026-06-16 · **Owner:** Trevor Goldsmith
**White-paper home:** _Communications layer_ (email) — this concretizes the under-specified **inbound email-to-matter capture** seam and adds the **native mail-client add-in** as the primary capture mechanism. Relates to _Matters and File Manager_, _Directory_, _Conflicts Check_, _Discovery_, _Client portal_, _Calendar and rules-based docketing_, _Notifications_.
**Research input:** three web-research passes, 2026-06-16 — legal PM/DMS email-filing competitive analysis (LEAP, Clio, MyCase, Smokeball, Actionstep, NetDocuments, iManage, Worldox); Outlook add-in capabilities (Office.js / NAA / event activation / manifest / AppSource); Gmail Workspace Add-on capabilities and the CASA scope boundary — synthesized inline; not a standing research doc. Brainstorm mockups under `.superpowers/brainstorm/`.
**ADRs (reserved, recorded on acceptance):** **ADR-0097** (email-filing subsystem architecture + add-in-led, CASA-free capture posture) · **ADR-0098** (email data model — message record + thread DAG + multi-matter junction + Message-ID dedup) · **ADR-0099** (filing-time conflict check + ethical-wall-safe "already filed" indicator). Builds on ADR-0091/0092 (integration port system + connection model; §11 credentialed adapter), ADR-0074 (`sendEmail` / Cloudflare Email Sending), ADR-0081 (inbound upload + quarantine), ADR-0082 (bulk download), ADR-0078 (content hash on write), ADR-0003 (tenancy), ADR-0052 (absence-not-existence), ADR-0084 (`protected()` + secrets), ADR-0096 (company email decoupled from product email), ADR-0029 (cookieless preview origin), ADR-0039 (compute placement), ADR-0083 (load-profile accretion); relates to _Communications layer_ (ADR-0047), _Notifications_ (ADR-0059), the time model (ADR-0055), _Discovery_ (ADR-0012), document versioning (ADR-0077).

> **This is a captured brainstorm, not a finished spec.** It records the decisions reached so far and the cross-cutting constraints the subsystem must honor. Several facets (predictive-match details, timeline render, outbound send-on-behalf, calendar) are still open (§13). It decomposes into slices that each get their own design → plan cycle on acceptance (golden rule 8).

---

## 0. Framing &amp; scope

Email shows up in the product in **three distinct roles**; only the third is this design:

1. **Platform → user system mail** — verification, invites, reset, notifications. Outbound only, no inboxes. **Already built** — the `sendEmail` port over Cloudflare Email Sending (ADR-0074). Out of scope here except as the interim outbound path (§11).
2. **Magna Carta-the-company's mailboxes** — operational identity / account-of-record. **Decided** — Google Workspace (ADR-0096). **Decoupled** from product email; out of scope.
3. **Firm-user email as matter data** — capturing each firm's _own_ email correspondence into the matter-centric system, as first-class thread-aware records. **This design.**

**The thesis that bounds scope:** Magna Carta is **not an email host**. Firms already have email. The product's job is to **capture and integrate** their existing email into matters — never to replace the inbox or build webmail. Email, to this app, is **an integration surface and a matter-linked correspondence/evidence stream**, not a mailbox product. That rules out a whole category of scope creep (no webmail, no IMAP server, no inbox UI).

In scope: the capture mechanisms, the matter-email record/data model, dedup, multi-matter association, attachment handling, storage/integrity, and the cross-cutting wiring. Calendar (the sibling on the same adapter) and messaging/voice (the other Communications channels) are **out of scope** here.

## 1. Strategy &amp; sequencing — the capture spectrum

Every capture method converges on **one pipeline and one record** (§2–3); they differ only in friction, reach, and procurement gate. The competitive analysis and the technical research settle the order.

| Mechanism | UX | Reach | CASA gate | Slice order |
| --- | --- | --- | --- | --- |
| **Add-in "Save &amp; File"** | one click, predictive matter suggestion + confidence (the LEAP/NetDocuments feel) | Outlook desktop/web/new · Gmail web/mobile | **none** (Outlook: no CASA exists; Gmail: `current.message.readonly` is _sensitive_, verification-only) | **first** |
| **Forward / CC to a capture address** | forward gesture | **any** client, any device | none | **first** (universal fallback) |
| **Full mailbox sync** | zero clicks, auto-capture + send-as | server-side | **yes** — restricted scopes (`gmail.readonly`) → CASA + Microsoft verification | **later** |
| **Legacy bulk import** | one-time migration | from LEAP / PST / file shares | n/a | **deferred** (rides LEAP migration) |

**The load-bearing finding (drives ADR-0097):** the **add-in "Save &amp; File" UX is both the best experience and CASA-free.** Outlook reads the open message via `getAsFileAsync` (full EML, Mailbox req-set 1.14) with NAA auth — Microsoft has no CASA equivalent. Gmail's narrow `gmail.addons.current.message.readonly` is _sensitive, not restricted_ — OAuth verification (days–weeks) but **no CASA audit**. CASA only bites when you reach **beyond the open message** into full-mailbox scopes (mechanism 3). So we deliver the LEAP-parity workflow **before** paying the CASA tax.

**Sequencing:** record model → **add-in + forward/CC** (both CASA-free) → **mailbox sync** (CASA-gated) → calendar (sibling) → legacy import (with LEAP migration). This front-loads value and defers procurement.

**Differentiation openings** (every incumbent leaves these open — competitive analysis): a truly **thread-aware relational** record (not a folder-file or loose "communications" list); **robust cross-user dedup** that doesn't break on drag-drop (§7); a **filing-time conflict / ethical-wall check** (no practice-management product does this — §12); **provider-agnostic web/mobile** filing; and **full-fidelity** capture (Clio stores text-only). Known incumbent failure modes to avoid: **wrong-matter auto-filing** (LEAP/Smokeball mass-file bugs — we never silent-auto-file; staff confirm) and **Outlook-COM fragility**.

## 2. The convergent pipeline — reuse the ingest chokepoint

Inbound email is **a source on the existing source-agnostic ingest / quarantine chokepoint** (white paper, _Matters and File Manager_; the same pipeline scan-to-matter and portal uploads use; ADR-0081). It is **not** a parallel path. Stages: **stage → scan / preview verdict → predictive matter match (confidence) → dedup → staff-accept onto matter(s)**. The untrusted-file pipeline that backs the scan stage is built in **slice 2·1** (malware engine deferred; launch verdict `unscanned`); email capture is one more capture adapter feeding it.

- **Staff-accept by default; auto-accept by configurable rule is an MVP option — but guardrailed** (§3a). The LEAP/Smokeball silent-misfile class is prevented _structurally_: **ambiguity (matches >1 matter) → suggest, never auto**; **a filing-time conflict / ethical-wall flag → hold for review, never auto**; rules fire on the **DKIM-authenticated sender** only (never a spoofable `From`); every auto-file is **reversible + audited** and surfaced in an **"auto-filed — review" digest** (filed but flagged, never silently buried).
- **Email Worker capture adapter** — the forward/CC path terminates on a **Cloudflare Email Worker** (PostalMime parse) behind the white paper's scan-capture plugin port; the add-in path terminates on an authenticated **API endpoint** (`file this MIME to matter`). Both produce the same staged record.
- **Compute placement** (ADR-0039): parse / extract / hash / index run **off the hot path** on Queues; large attachments escalate to Containers. The forward path has a **~25–40 MiB Email-Worker ceiling** → the documented large-file fallback (add-in handles larger via `getAsFileAsync`/Graph; desktop bridge later).

## 3. Data model — first-class, thread-aware, multi-matter

Per-firm D1 metadata over per-firm R2 bytes (golden rule 3; bulk content to R2, never D1). Drives ADR-0098.

- **`email_message`** — one row per unique message, the unit of truth. Keyed by **`Message-ID`** (+ firm). Carries: from/to/cc, subject, sent/received instants (UTC `Temporal.Instant`, ADR-0055), `thread_id`, `references`/`in_reply_to`, the **content SHA-256** (ADR-0078), DKIM-verification result, and an R2 ref to the **verbatim original** (full fidelity). Sensitive bodies/fields are `protected()` where flagged (ADR-0084).
- **`email_thread`** — the conversation, modeled as a **DAG** (not a line): messages linked by `Message-ID` / `References` / `In-Reply-To`. Forks and late-merging "private" sub-threads are linked by ID, or reconciled by content hash when only known from a quote (§10).
- **`email_matter_link`** (the junction — the multi-matter spine, §8) — `(email_message × matter)`, **unique on the pair**. Carries per-matter context: who linked it, when, per-matter tags, provenance. **Access is per-link/per-matter.**
- **`email_participant`** — each from/to/cc resolved to a **Directory** Person/Organization (§12); the address-as-it-was is frozen at receipt (temporal history).
- **Attachments** — extracted to the **File Manager** as first-class `file`/`file_version` documents (§9), R2-deduped by content hash; an `email_attachment` link ties them back to the message + thread.

Reconstruction: a matter's email view is assembled from all messages linked to that matter, deduped by `Message-ID`, ordered by the thread DAG + time — **never** a re-saved per-reply blob.

### 3a. Auto-file rules (the configurable-auto-accept model)

- **`autofile_rule`** — per-firm rows, `condition → matter`. Condition kinds by precision: **thread-continuation** (a reply to an already-filed thread → its matter — safest), **participant + matter** ("emails from this client/counsel → this matter" — precise, matter-scoped), **subject matter-#/keyword** (safe), **sender-domain → matter** (allowed but flagged risky). Rules are mostly **learned from real filing** — a one-tap "+ Always auto-file emails from {sender} on this matter" offered when staff file manually — not an abstract editor (which exists for power users).
- **Guardrails are part of the model, not optional** (§2): a rule never fires on ambiguity (>1 matching matter), never across a conflict/ethical-wall flag, only on a DKIM-authenticated sender; every firing is logged with the rule id, is one-click reversible (which also suppresses the pattern), and lands in the "auto-filed — review" digest.

## 4. Capture A — the native add-in (Outlook + Gmail), CASA-free

The hero mechanism. One panel: **predictive matter suggestion** (from the message's participants matched to Directory/matters, with a visible **confidence signal** — matching NetDocuments' Signal Strength, beating LEAP/Clio heuristics), confirm, **Save & File**; plus **Send & File** on compose.

**Outlook (priority — most US firms / the owner's firm are Microsoft 365):**
- Read the open message: **`getAsFileAsync`** → full Base64 EML (req-set 1.14); **Graph `/messages/{id}/$value`** fallback (mobile, server enrichment). Graph metadata (sender/recipients/subject/`conversationId`) drives the prediction.
- Auth: **NAA + MSAL.js** (mandatory since Feb 2025; legacy Exchange/callback tokens retired). Mint a token for Graph _and_ our API; validate the Entra identity claims server-side.
- **Send & File:** `OnMessageSend` Smart Alert (req-set 1.12) can block/confirm if no matter chosen. Auto-suggest on arrival via `OnNewMessageCompose`/read events — bounded by the 5-min handler / stay-on-item / max-5-add-ins limits.
- Manifest: target **XML (add-in-only)** for now (unified JSON lacks Outlook-Mac, modules, multi-select — and we want "file these N emails"). Maintain unified later.
- Distribution: **admin / Integrated-Apps central deployment** (mandatory for event-based add-ins); AppSource only if we list publicly. **No CASA.**
- Gotchas (research): attachment IDs are session-scoped (capture in one pass; popping out a compose ends the session); cloud "Upload &amp; share" attachments aren't returned as bytes (§9); event handlers don't fire reliably for offline-drafted-then-sent; design the pane to queue/retry.

**Gmail (fast-follow):**
- **Workspace Add-on**, CardService UI (no arbitrary HTML), contextual trigger on open + compose trigger for Send & File; renders on web + mobile.
- Scope: **`gmail.addons.current.message.readonly`** (+ `current.action.compose`) — **sensitive, verification-only, CASA-free.** Gives body + headers + `getAttachments()` for the open message. Raw RFC822 of _arbitrary_ messages would need restricted `gmail.readonly` → **avoid** (that's mechanism 3 / CASA).
- Backend auth: alternate-runtime add-on; verify `systemIdToken` (request came from Google) + `userIdToken` (who), then mint our session.
- Constraint vs Outlook: CardService is less flexible than Outlook's HTML pane; contextual triggers are unconditional-only.

## 5. Capture B — forward / CC to a capture address (Email Worker)

The universal, any-client fallback (mobile, Mac, any provider). Routing model — **per-matter address + firm catch-all** (chosen direction): each matter exposes a unique token address (e.g. `matter-<token>@in.magnacarta.esq`) that pre-files for one-click accept; a firm-wide catch-all takes the rest into an unrouted queue for staff routing; heuristic sender/subject matching is layered as an _assist_, never the sole router. Terminates on a Cloudflare **Email Worker** → ingest chokepoint (§2). DNS for the inbound capture subdomain co-tenants the `magnacarta.esq` zone and is coordinated with the product's Email Sending and the company Workspace MX (ADR-0096 — one DMARC for the zone).

## 6. Capture C — mailbox sync (deferred; §11 credentialed adapter, CASA-gated)

The "zero-clicks, automatic + send-as" tier. This is the integration port system's **deferred §11 credentialed email/calendar adapter** (ADR-0092): **user-scoped** connection (each attorney authorizes their own mailbox — the ethical-wall-correct scope), OAuth 2.0 + PKCE, refresh-token rotation under the Durable-Object-per-credential lock, the generic sync engine + webhook ingress (Google watch channels / Microsoft Graph subscriptions), credentials in the slice-1·2 `firm_secret` store. **Gated on slice 1·2 + the Google CASA / Microsoft verification compliance review** (procurement, not engineering — name it early). Feeds the **same** record model and dedup as A/B, so it adds no parallel data path.

## 7. Dedup &amp; the "already filed" indicator

The cross-user correctness win (drives part of ADR-0099). Two attorneys on the same email, one files it:

- **Dedup identity = `Message-ID`** (+ firm) — identical in every recipient's copy, so cross-user/cross-inbox dedup just works. **Fallback** when a Message-ID is stripped/rewritten: a content hash of normalized headers + body.
- **The second attorney's add-in shows "Already filed to {Matter} by {who} · {when}"** (a click-through if they have matter access) instead of a file button — like NetDocuments' Global Filing Indicator, done right. No accidental double-file.
- **One record, many filers** — if they file anyway (or via forward/sync), the server dedups to one record with provenance ("also confirmed by …"). **No duplicate-across-matters** (the LEAP/Clio bug).
- **Wall-safe** (ADR-0052 absence-not-existence): a viewer with **no access** to the matter it was filed to sees a generic **"already captured by your firm"** — never the matter name. The indicator can't become an oracle for a walled matter's existence.
- **Same signal across every capture surface** (add-in, forward, sync) — all do the `Message-ID` lookup.

## 8. Multi-matter — one message, many links

An email legitimately belonging to several matters (one client/multiple matters, related litigation, an email touching two cases) is **stored once and linked many times** — the `email_matter_link` junction (§3), never copies.

- **Junction, not copy** — body + attachments stored once; each matter gets a cheap link row. **Unique on `(message, matter)`** — can't double-file to the _same_ matter, can link to _many_.
- **Per-matter everything** — access, tags, "linked by", and where the attachment sits in each matter's File Manager are per-link.
- **Access is per-matter and independent** — opening the email from Matter X shows an "Also on …" list **filtered to matters the viewer can access**; a link to a walled matter is invisible to those off the wall. The email is seen _through the lens of each matter you can access_, never as one global object.
- **Unlink ≠ delete** — removing one link keeps the message on the others; the last link removed orphans it → retain/delete per policy + legal hold (infected/evidence files are never auto-deleted — security conventions).
- **Threading across matters** — later replies propose the thread's existing matter set; staff confirm per matter.

## 9. Attachments — first-class matter documents

Yes, attachments are saved — extracted into the matter's **File Manager** as first-class `file`/`file_version` documents (searchable, previewable, versioned), **while the original email is also kept whole** for fidelity/evidence (beating Clio's text-only loss).

- **Stored once in R2 by content hash** (ADR-0078) — the same PDF re-sent through five replies, or filed to three matters, is **one blob**; per-matter document records point to it.
- **Untrusted → the same chokepoint** — staged, magic-byte gated, malware-scanned, preview-verdict, **quarantined until cleared** (ADR-0081; engine in 2·1). Served only from the **cookieless preview origin** (ADR-0029), never inline-active.
- **Inline signature/logo images filtered** out of documents (a `cid:`-embedded logo isn't a document), with a one-click "promote" if one matters. Distinguishes real attachments from decorative inline images — a nuance incumbents handle inconsistently.
- **Cloud "Upload &amp; share" / Drive links** captured as references (not bytes); fetch a copy if permissions allow.
- **You choose what to file** — the email, the attachments, or both.
- **Large attachments** — the add-in path handles big files; the forward path hits the Email-Worker ceiling → fallback (§2).

## 10. Storage &amp; integrity

Two answers — storage is cheap by design; quoted-history redundancy becomes an _integrity asset_.

**Storage levers:**
- **Message dedup** (store each unique message once by `Message-ID`; thread = links, not a re-saved blob per reply) + **attachment dedup** (content hash) are the levers. A growing A→AB→ABD→ABCDE chain stores E once and links to existing A/B/D.
- **Body kept verbatim** (it's KB), but the **search index gets only the _new_ content per message** — no N copies of quoted history bloating Tantivy/Vectorize.
- **Reality check:** ~few KB/email → 100k emails ≈ a few hundred MB ≈ cents/mo (R2 ~$0.015/GB-mo). **Attachments dominate cost — and they're deduped.** No body delta-compression (complexity not worth it vs. evidentiary "keep verbatim").

**Integrity (quoted history is untrusted):**
- **The authenticated message is the unit of truth** — each individually-received message verified by its own **DKIM** signature, recorded immutably. Quoted history embedded in a later reply is unauthenticated hearsay.
- **Tamper diff** — because we hold the real A _and_ a reply that quotes A, we **diff the quote against the original and flag discrepancies** ("…pay $50,000" vs the real "…pay $5,000"). A genuine forensic feature no incumbent offers.
- **Threads are DAGs** — forks + late-surfacing "private" messages linked by ID/References; any segment known only from a quote is marked **"unauthenticated — from quote"** until the real message is filed.

## 11. Outbound matter correspondence (open; interim path)

The white paper's _Communications layer_ dual-send posture: **matter correspondence routes through the firm's own mailbox** (so it threads in their Sent and uses their real address) — which needs the **send scope of the sync adapter** (§6, CASA-gated). **Interim, pre-sync:** "Send & File" via the add-in (compose in the native client, file on send) covers most outbound without us sending at all. A platform-sent "as the attorney" path (via Email Sending with the attorney's address) needs SPF/DKIM delegation and is **not** chosen now (deliverability + spoofing risk). Open (§13).

## 12. Cross-cutting integrations (what else to consider — from the white paper + roadmap)

- **Directory (slice 1·3)** — every participant resolves to a **Person/Organization** entity (no shadow address lists); representation/affiliation edges tag external counsel; name/affiliation frozen as-at receipt (temporal history). **Gate:** rich predictive matching + participant linking want Directory; pre-1·3 the add-in can match on matter client display fields only.
- **Conflicts + ethical walls (Phase 4; ADR-0099 here)** — **filing-time conflict check** (our differentiator): linking an email surfaces conflict signals against the matter's parties and the email's participants, matched against the `protected()` HMAC **blind index** without decrypting (ADR-0084). Filing to a matter **walled from** one the email is already on can flag (§7/§8). The immutable conflicts log records re-checks. Full engine is Phase 4; the **filing-time hook is the seam to place now**.
- **Tenancy &amp; security** — per-firm D1 + R2 through the firm-scoped DAL (ADR-0003); sensitive bodies/identifiers on `protected()` (ADR-0084); per-firm crypto-shred; **absence-not-existence** for every walled/missing case (ADR-0052); attachments untrusted (ADR-0081) and served only from the cookieless origin (ADR-0029).
- **Notifications (backlog; ADR-0059)** — "email arrived / filed to matter" is a **notification type** in the registry, raised off the hot path; external channels carry **no privileged content** (a deep link, never the body). **Gate:** the Notifications subsystem still needs its spec — the raise-seam is placed, delivery rides it when built.
- **Discovery (Phase 5; ADR-0012)** — email is a discovery source: thread-aware indexing (Tantivy + Vectorize), near-duplicate detection, attachment OCR, Bates/redaction/privilege-log on production. **Open:** thread-as-one-doc vs message-as-doc for the index; email-body redaction model. The capture record must be discovery-ready (content hash, chain-of-custody audit).
- **Client portal (Phase 6)** — sharing an email/thread is a `PortalGrant` with an assurance level; portal contributors can upload EML/MSG which **quarantine** on the same chokepoint. Recipients are Directory entities.
- **Calendar (sibling, §23)** — rides the **same** credentialed adapter (§6); two-way Google/Outlook sync; rules-based docketing can extract deadlines. Out of scope here, but the adapter is shared, so the connection model is co-designed.
- **Transactional email (ADR-0074)** — `sendEmail` / Cloudflare Email Sending is the **system** outlet (`no-reply@`); distinct from matter correspondence (§11). One DMARC for the `magnacarta.esq` zone coordinates product-send, inbound-capture, and the company Workspace (ADR-0096).
- **Performance / load profile (ADR-0083)** — ingest/index off the hot path (Queues/Containers); the email + link + attachment volume and the volume-shaped reads (a matter's threads, a thread's messages, the "already filed" lookup, dedup probes) join the load harness in-area (accretion rule).

## 13. Facet triage — MVP / fast-follow / later

Laned with the owner (2026-06-16). The throughline: **MVP = everything the add-in + forward path needs to be genuinely useful and safe**; every "later" facet is parked because it **depends on a subsystem not yet built** (sync/CASA, Discovery, Notifications, the LEAP migration), not as an arbitrary cut. Several facets **split** — a cheap core ships MVP, the polish follows.

**MVP — the launchable CASA-free filing slice:**
- **Predictive matter-match (heuristic)** — a transparent ranked suggestion with an **explainable reason** + confidence badge, over the signal ladder: thread-continuation and subject matter-#/name (CASA-free, no Directory) → participants∩parties and sender-domain→org (need Directory 1·3) → recent-matters tiebreaker. Degrades gracefully pre-Directory. (ML / filing-history scoring → fast-follow.)
- **Configurable auto-file rules (guardrailed)** — `condition → matter` rules, mostly learned from real filing, with the structural guardrails (ambiguity/conflict → never auto; DKIM-authenticated sender; reversible + surfaced in a review digest). Decided 2026-06-16 (§2/§3a) — the powerful option, made safe.
- **Matter correspondence timeline (concept confirmed; UI deferred)** — the matter gets a **chronological correspondence view** of its filed threads (owner, 2026-06-16: "a timeline would be cool"). The **data model already supports it** (thread DAG, per-message new-content extraction, DKIM result, participant + attachment links), so the render is a pure UI-layer concern — **deferred to the UI plan** (post-0·7a/0·7b, as with the 1·1 / 1·3 UI plans), not designed here. Direction when it's built: collapsible conversation view, quoted history hidden by default, Directory-linked participants, attachment chips, provenance; the integrity markers (tamper-diff, "from quote") and any fork visualization are fast-follow render add-ons.
- **Send &amp; File (add-in)** — compose in the native client, file on send; outbound without the platform sending.
- **"Already filed" on panel-open** — Message-ID lookup, wall-safe; prevents double-filing. (Proactive auto-badge → fast-follow.)
- **Add-in admin distribution** — central / Integrated-Apps per-firm deploy (mandatory for event-based add-ins).
- **Multi-matter visibility** — _inherent_ to the junction model; no extra build.

**Fast-follow — polish &amp; reach, right after launch:**
- **Confidence / ML matter-scoring** (Signal-Strength-style ranking beyond heuristics).
- **Proactive "already filed" badge** on message-open (read-event trigger) vs. only on panel-open.
- **Multi-select "file these N emails"** (needs the XML manifest path).
- **Integrity-marker UX** — "unauthenticated — from quote" markers + tamper-diff surfacing on the timeline (§10).

**Later — gated on other subsystems:**
- **Platform send-as-attorney** (§11) — needs the mailbox-sync adapter + SPF/DKIM delegation; interim Send & File covers the need.
- **Discovery indexing unit** (thread vs message) + **email-body redaction** — Phase 5; the capture record stays discovery-ready now (content hash, structure).
- **Active notify-on-second-file** (§7 sub-question) — pinging the original filer needs the **Notifications** subsystem (still in backlog); passive visibility on both matter timelines is already inherent.
- **Legacy bulk import** (LEAP / PST / file-shares) — same record shape ("just another source"); rides the **LEAP migration** (trust-reconciliation cutover gate).

## 14. Decisions to record &amp; docs to update (on acceptance)

- **New ADRs:** **ADR-0097** (subsystem architecture + add-in-led CASA-free capture posture; corrects the white paper's "OAuth mailbox sync is the email integration" framing — the add-in is the primary, CASA-free capture, sync is the later tier), **ADR-0098** (the data model — message record + thread DAG + multi-matter junction + Message-ID dedup + first-class attachments), **ADR-0099** (filing-time conflict check + ethical-wall-safe "already filed" indicator).
- **White paper:** _Communications layer_ email section gains the inbound-capture mechanisms and the add-in posture; the _Plugin / Add-on system_ "email/calendar is the launch adapter" line is reconciled with the CASA gate (sync is the credentialed tier; add-in/forward come first).
- **ROADMAP / STATUS:** add the email-filing subsystem and its slice decomposition (record model → add-in + forward → sync → calendar → import); slot the first CASA-free slice against Phase 1/2 dependencies (File Manager built; Directory 1·3; untrusted pipeline 2·1). **CHANGELOG** + **user docs** ship with each slice (golden rule 5).
- **Operating-cost register:** the Google CASA assessment (already listed, §D) binds when the sync adapter (§6) is built; the add-in/forward slices add no new recurring cost.
