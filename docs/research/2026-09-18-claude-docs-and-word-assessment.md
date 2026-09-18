# Claude Docs and Claude for Word — assessment

**Date:** 2026-09-18 · **Revised:** 2026-09-18 (second pass — section 5 examines each candidate action against the code and the vendors)
**Scope:** What Anthropic shipped as Claude Docs and Claude Slides (2026-09-16) and as the Claude for Word add-in (2026-04-10), what each actually is, and an honest fit assessment against Magna Carta's built documents-and-automation subsystem.
**Purpose:** Research, prompted by the owner. **This is research, not a spec and not a decision.** Nothing here is built or committed; everything labelled a recommendation is a recommendation only. The binding decisions in this area are already recorded — ADR-0010 and ADR-0125/ADR-0126 (the editor and its concurrency model), ADR-0011 (document automation), ADR-0109 through ADR-0113 (AI / inference) — and nothing in this document changes them.
**White-paper context:** _Documents_, _Document Automation_, _AI / inference_ — binding, not restated here.

---

## 1. Summary

Two products launched five months apart, and only one of them is about us.

**Claude Docs is excluded by our own confidentiality posture, and the exclusion is the vendor's, not ours.** Anthropic's help page states that Claude Docs "isn't available for customers that use customer-managed encryption keys (CMEK), zero data retention (ZDR), or a HIPAA-ready configuration." ADR-0110 pins this platform at ZDR-on, payload-logging-off, with a fail-closed per-request guard that refuses rather than downgrades; ADR-0109's standing recommendation is that privileged content reaches a third-party frontier model **only** under ZDR. The product and the platform's posture are therefore mutually exclusive as shipped. There is no integration question to answer, no procurement path to open, and no judgment about product quality required to reach that conclusion.

**The editor was never the gap, and Claude Docs does not close one.** Every capability Claude Docs advertises — browser rich-text editing of `.docx`, real-time co-authoring, comments, export to PDF — is built here already, through Collabora on Containers behind our own WOPI host (ADR-0010, ADR-0125), and on two axes we are materially ahead: Claude Docs has **no version history**, where this platform has app-managed immutable version objects with a content hash computed on write and storage tiering (ADR-0035, ADR-0077, ADR-0078); and Claude Docs cannot share outside the organization, where the client portal is the whole point of a firm's outbound document path.

**What is worth taking is the drafting loop, and specifically the shape Claude for Word gave it.** Claude for Word surfaces every model edit as a Word tracked change the attorney accepts or rejects. That is not a feature to license — it is an add-in to a competitor's editor and it cannot reach documents that live in per-firm R2 behind our WOPI host — but it is the correct interaction contract for a legal platform, and it is one this codebase is unusually well positioned to build: `@magna-carta/metadata`'s OOXML walker already reads `w:ins`/`w:del` revisions **with their `w:author` attribution**, Collabora authors and renders revisions natively, and Magnus's own unbuilt actions node already commits to propose-and-approve. A tracked change is propose-and-approve expressed in the file instead of in a dialog, and it survives export.

So the recommendation is: **adopt nothing, ratify the exclusion in writing, and treat the tracked-change AI edit as the shape of the document-automation merge-intelligence slice that is already on the roadmap.**

---

## 2. What actually shipped

| Product                     | Date       | What it is                                                              | Where it runs                                 |
| --------------------------- | ---------- | ----------------------------------------------------------------------- | --------------------------------------------- |
| **Claude Docs** (beta)      | 2026-09-16 | A rich-text editor inside Claude; documents live in the Artifacts tab   | Anthropic's product, browser                  |
| **Claude Slides** (beta)    | 2026-09-16 | The same, for presentations                                             | Anthropic's product, browser                  |
| **Claude for Word** (beta)  | 2026-04-10 | A sidebar add-in for Microsoft Word on Mac and Windows                  | The user's own Word install, over their files |

**Claude Docs, as documented by Anthropic.**

- Multiple co-authors edit simultaneously; comments support `@Claude` mentions, so the model is a participant in the document rather than a chat beside it; edits are attributed per contributor.
- Export to Word, PDF, Markdown, and Google Docs. More formats are stated as planned.
- Plans: Pro, Max, Team, Enterprise. Not on Free. On by default except on Enterprise, where an organization owner enables it, optionally per custom role.
- Claude "acts with the permissions of the person who asked."
- Stated limitations, verbatim in substance: **no version history**; no comment-only permission level; charts and diagrams do not auto-update from connected apps; Team and Enterprise cannot share a doc outside the organization; and **unavailable for CMEK, ZDR, or HIPAA-ready configurations**. Usage counts against normal consumption limits, with larger requests consuming more.

**Claude for Word, as documented and as reported.**

- Contract review, redlining, clause-by-clause comparison, and drafting from templates, with legal contract review as the lead use case.
- **Every proposed edit lands as a tracked change** — insertions and deletions marked as a human reviewer's would be — accepted or rejected in Word's review pane before it is part of the document.
- Anthropic's own guidance advises against using the beta on highly sensitive or privileged documents without proper controls, and warns explicitly about **prompt injection from untrusted documents**: hidden instructions inside a file that redirect the model.

**A third artifact worth recording,** because it is the most technically interesting of the three and the least reported: Claude Docs exposes documents to an agent as a **structured, block-addressable editing surface** rather than as a blob of text. A document is a tree of blocks with stable identifiers; an edit is an op (`insert`, `replace`, `delete`) targeted either at a block identifier **guarded by a hash of that block's current content**, or at a quoted phrase where the quoted words are themselves the guard. A guard that no longer matches is refused outright, with the refusal stating that a person changed those words first. Section 4c takes this up, because it is the piece that separates "a model can produce text" from "a model can edit a firm's filed document without silently overwriting a paralegal's sentence."

---

## 3. Fit assessment — capability by capability

Every row is read from the build register (`docs/now.md`) and the feature ledger, not inferred.

| Claude Docs capability          | Magna Carta's home                                                                       | Status                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Browser `.docx` editing         | Collabora per open document, per-document Durable Object, our own WOPI host               | **Built** (ADR-0010, ADR-0125)                                                        |
| Real-time co-editing            | The same live session; one WOPI lock, co-editors join it                                  | **Built**; the presence layer over it is designed, not built                          |
| Who has it open, live           | `docs/specs/2026-08-25-document-presence-design.md`                                       | **Designed only** — ledger item P16                                                   |
| Comments in the document        | Collabora carries OOXML comments; `@magna-carta/metadata` detects them                    | Editor-level only; no platform surface over them                                      |
| Version history                 | App-managed immutable version objects, content hash on write, Standard→IA tiering         | **Built, and ahead** — Claude Docs has none at all (ADR-0035, ADR-0077, ADR-0078)     |
| Templates and assembly          | `@magna-carta/document-assembly`, the expression language, the merge-field dictionary     | **Backend built** 2026-08-11; the interface is the gap                                |
| Export to PDF                   | The conversion format registry and the LibreOffice engine                                 | **Built** (ADR-0030)                                                                  |
| Sharing outside the firm        | The client portal                                                                         | Unbuilt here — but Claude Docs forbids it outright on Team and Enterprise             |
| The model **inside** a document | `ai.consumer-seams`; "document-automation merge intelligence" as a slice 2·6 consumer     | **Not started** — the one genuine gap this comparison exposes                          |
| Confidentiality posture         | ZDR-on fail-closed, curated ZDR-only catalog, two fail-closed consent gates               | **Built** — and it is precisely what disqualifies Claude Docs                          |

The table says the thing plainly: **Claude Docs is not a capability we lack.** It is a competitor to a surface we already ship, minus version history, minus external sharing, and minus the configuration a law firm is obliged to run under. The only row that reads "not started" is the one Claude Docs is genuinely good at and the one the roadmap already owns.

---

## 4. What it could mean for implementation

Four candidates, ordered by what I would actually do.

### 4a. Ratify the exclusion in writing — cheap, and it stops the question recurring

"Why not just draft in Claude Docs, or Google Docs, or Word online?" is a question that will be asked again, by a firm and eventually by us. The answer exists today but only as an inference across ADR-0109, ADR-0110, and the build-in-or-plugin test in the white paper. It deserves one sentence in its own home: **privileged client documents are drafted in the platform's own editor because the firm's confidentiality configuration — customer-managed keys, zero data retention — is the exact configuration the third-party document workspaces exclude.** That is a stronger and more durable argument than any product comparison, because it does not decay when the competing product improves.

Cost: one `docs/decisions/pending/` fragment, or a paragraph in the white paper's _Document Automation_ topic. Recommendation: **do it.**

### 4b. The tracked-change AI edit — the real opportunity, and it is already slice-shaped

The proposal: Magnus can propose edits to a document open in the editor, and **every proposal lands as an OOXML tracked revision authored under a distinct, non-human author identity**, which an attorney accepts or rejects in Collabora's review pane. Nothing is written into the document as ordinary text by a model, ever.

Why this fits here better than it fits anywhere else:

- **It satisfies the propose-and-approve rule structurally rather than by policy.** `ai.magnus.actions` is ledgered as "propose-and-approve only, where a tool proposes, a member approves, and the approval is the audited act." A tracked change is exactly that, with the document format serving as the approval queue — no second surface to build, and no way for a proposal to skip the gate.
- **Attribution is a records requirement here, not a nicety.** The platform already treats Magnus transcripts as discoverable firm work product (`ai.magnus.record`). A filed document in which model-authored text is indistinguishable from attorney-authored text is the same problem one step worse. A `w:ins` carrying a `w:author` of record answers it in the file itself and survives export to every recipient.
- **The machinery is largely present.** `packages/metadata/src/ooxml/walk.ts` already classifies the full revision vocabulary — `w:ins`, `w:del`, `w:moveTo`, paragraph-mark revisions, `w:cellIns` and row-level `w:trPr` deletions — and can accept or strip them; `packages/document-assembly/src/ooxml/` reads and re-emits OOXML packages under a defensible order; Collabora authors and renders revisions natively; and the per-document `DocumentSession` Durable Object is already the coordination point and already holds the working object's hash, size, and server-assigned timestamp.
- **The consent plumbing is built.** Both fail-closed gates ship (`ai.magnus.consent`), the firm-administrator enablement screen ships, and the inference chokepoint is the only path to a model.

The hard problems, named up front rather than discovered later:

1. **Two writers, one working object.** A model edit and a live co-editing session both mutate the same `current` object. The proposal must go through the same serialized path the editor does — host-side against the WOPI lock, or through Collabora's own interface — and **never** a side write to R2. ADR-0126 already owns this question for human writers; the model is one more writer, not a new category.
2. **The context grant shape is right but thin.** `ai.magnus.context` is partial precisely because a grant is a document today and extraction runs on every question. This feature wants that seam, and would justify closing the caching gap the node already names.
3. **Prompt injection becomes ours.** The moment a model reads a document a client or opposing counsel supplied, the risk Anthropic warns about for its own add-in is the platform's risk. It is real today — the grant already permits it — and it belongs in the security conventions, not buried in a document spec.
4. **The real gate is procurement, not engineering.** ADR-0110 records that the Cloudflare/Anthropic ZDR artifacts gate the first real AI feature. That gate stands in front of this, and is unmoved by anything in this document.

Recommendation: **this is the shape the slice 2·6 merge-intelligence consumer should take when it is drawn.** Not a chat that returns text to paste, and not a model with write access — a revision the attorney accepts.

### 4c. Steal the block-addressable edit contract as a design, not as a dependency

If 4b is built, the internal contract between Magnus and a document needs a shape, and the shape Anthropic chose for Claude Docs is better than the obvious one. Addressing an edit to a stable block identifier **and** carrying a hash of that block's content as a guard, with a refusal when the guard no longer matches, is what prevents a model rewriting a sentence a human changed thirty seconds earlier — the failure mode that a whole-document rewrite cannot even detect. The alternative addressing mode is as useful: target a quoted phrase, and let the quoted words be their own guard, so a proposal can be expressed without reading the document's structure first.

This maps onto discipline this codebase already has rather than fighting it: content-hash-on-write is ADR-0078, and the timestamp-guarded WOPI write path is ADR-0126. The guard is the same idea one level down, at the block rather than the file.

Recommendation: **note it now so it is not re-derived under time pressure later.** No build.

### 4d. Ingest and provenance — this one lands whether or not we build anything

Claude Docs exports `.docx`; Claude for Word edits `.docx` in place. Documents drafted this way are already arriving at firms — from clients, from opposing counsel, and from the firm's own staff working on their own machines. Three existing surfaces meet them:

- **AI-text detection.** `@magna-carta/ai-detection` is paste-text-only today; its design names document text-extraction as a later seam, and the vendor was chosen partly because it detects Claude specifically. A document-level answer is worth considerably more to a firm than a text-box one, and the gap is now more likely to matter than when it was written.
- **Outbound metadata scrub.** A Claude-authored `.docx` can carry tracked changes and comments attributed to a model. The white paper already commits to stripping metadata on every outbound document as a built-in capability; the inspector already finds these artifacts. What is missing is the outbound chokepoint that runs it by default rather than on request.
- **Untrusted-document prompt injection.** Covered in 4b, but it is worth stating that this arrives at ingest and is not exclusive to the drafting feature.

Recommendation: **no new work from this document.** It sharpens the case for the two seams already named.

### 4e. What not to do

- **Do not reopen the editor decision.** ADR-0010 is locked and Collabora is shipping. A competitor launching a browser editor with no version history is not evidence against it.
- **Do not put inference into the deterministic assembly path.** The document-automation design already refused this by name: "a merge that sometimes guesses is a merge that cannot be relied on for a filing." A better model does not change that argument — it makes the guess more convincing, which is worse.
- **Do not treat the white paper's catalogued "AI drafting / legal-AI assistant" plugin as satisfied by Claude for Word.** It is an add-in to a competitor's editor, operating on files on a user's disk. It cannot reach a document in per-firm R2 behind our WOPI host, and a firm using it is working outside the platform's audit trail, version ladder, and ingest chokepoint.

---

## 5. Second pass — what each candidate action actually takes

Written the same day, after the owner asked for the candidates to be looked into. Each is examined against the code and against the vendors' documented behaviour, and each ends in a shape rather than a recommendation to think further.

### 5a. Ratifying the exclusion — one fragment, and the sentence it should carry

The shape is a `docs/decisions/pending/` fragment, status **Proposed**, area _Documents_, so it is numbered at merge and the owner's acceptance is the decision rather than this note. The sentence it should carry:

> Privileged client documents are drafted in the platform's own editor. The third-party document workspaces — Claude Docs today, and any successor on the same terms — are unavailable under customer-managed keys and zero data retention, which is the configuration ADR-0110 binds this platform to. The choice is therefore made by the firm's confidentiality obligation, not by a product comparison, and it does not decay when the product improves.

Not written here, because a Proposed fragment on a branch the owner has not read is a decision by default. It is a five-minute act once the owner says yes.

### 5b. The tracked-change AI edit — the path that works, and the two that do not

There are three ways to get a revision authored by Magnus into a document. Examined against the editing code, one survives.

**Through the live Collabora session, by `postMessage`.** Collabora's `Send_UNO_Command` (22.05.13 and later) lets the host page drive the editor — turn on `.uno:TrackChanges`, run a find-and-replace — so a proposal _could_ be applied inside the open session. It fails on the one thing the feature exists for: **every revision is attributed to the session's user**, because coolwsd takes the author from `CheckFileInfo`'s `UserFriendlyName`. The change would carry the attorney's name. A second WOPI session under a service identity would fix attribution, but a WOPI session needs a Collabora _client_ — a browser — and coolwsd has no headless UNO-over-WOPI. **Rejected.**

**Host-side, into the working object.** The Worker writes `w:ins` and `w:del` elements — `w:author="Magnus"`, a `w:date`, the `w:id` sequence — into the `current` object, through the same package code `@magna-carta/document-assembly/src/ooxml/` already reads and re-emits, under the `DocumentSession` Durable Object's serialization, bumping the host-assigned timestamp exactly as a `PutFile` does. With no session live, the next open shows the revisions in Collabora's review pane and nothing else changes. With a session live, Collabora's next save presents the stale `X-COOL-WOPI-Timestamp`, the host answers `409` with `COOLStatusCode 1010` — **already built**, the timestamp-guarded write path of the slice 2·2 design — and Collabora's documented behaviour takes over: it prompts the editor to reload or keep their unsaved changes, and **if there are no unsaved changes it reloads silently**. So a proposal applied while the editor is idle simply appears. **This is the path.** The two-writers problem of section 4b resolves the same way: the Durable Object is the only writer of `current`, the apply is one more method on it that takes the same lock and performs the same bump, and the editor experiences it as the external-modification case it already handles.

What is missing is narrower than it looked. `packages/metadata/src/ooxml/walk.ts` classifies the whole revision vocabulary and can accept or strip it; **nothing in the tree writes a revision.** The work is an OOXML revision writer (insert-at, delete-range, replace-as-delete-plus-insert, each producing well-formed `w:ins`/`w:del` around runs), the addressing in 5c, and an apply verb on the Durable Object. The proposal's life before that: Magnus, over a context grant (`ai.magnus.context` — a grant is a document, which is the shape this needs), produces a **proposal set stored as a firm record and not applied**; the member reviews it as a list; "Apply as tracked changes" is the audited act; acceptance then happens where it should, in the review pane, and the version cut on Save records the result.

**Through a browser-local editor.** The companion note (`2026-09-18-local-first-document-editing.md`) examines SuperDoc, which has an agent surface and tracked changes. Its 2.x has an open issue that a programmatic tracked change **cannot be attributed to a chosen author** (superdoc/docx-editor#3998 — 1.x could, 2.x cannot), and attaching an agent to a live collaboration room with attributed changes is a second open issue (#3568). So today even that route ends at the same OOXML writer. It is not a reason against the local editor; it is a reason the writer is ours to build either way.

### 5c. Block addressing — the format already has the block identifier

The stable per-block identifier the Claude Docs contract relies on is **native to OOXML**: Word writes `w14:paraId` — eight hex characters, unique within a part — on every paragraph, and LibreOffice's DOCX export writes it too (`sw/source/filter/ww8/docxattributeoutput.cxx`), with round-trip cases in its test suite. So an edit can be addressed to a paragraph by an identifier the document already carries, and the guard is a hash of that paragraph's run text — the block-level version of the content-hash-on-write discipline ADR-0078 applies to the file.

Two things to verify on our own container before relying on it, and neither is a blocker: that Collabora preserves the _imported_ `paraId` of a paragraph it did not touch across a save rather than regenerating it, and what identifier a paragraph Collabora splits ends up with. A paragraph that has lost its identifier degrades to the second addressing mode — a quoted phrase whose words are their own guard — which needs no identifier at all. The contract therefore has a fallback that is never worse than what a whole-document rewrite offers.

### 5d. Ingest and provenance — smaller than the section above implied

The AI-detection seam is one wiring job, not a feature: the Pangram design names "document text-extraction" as a later seam, and `@magna-carta/metadata` already extracts document text to inspect it, so the seam joins two packages that exist. The outbound scrub is not work now for a plainer reason: `documents.metadata.ooxml` is shipped and stateless, `documents.metadata.ui` is not started, and **there is no outbound chokepoint to hang a default scrub on** — no portal share and no email-send-with-attachment path exist yet. It is a line against the client-portal and email slices, to be built when they are.

---

## 6. Open questions for the owner

1. **May a model author into a filed document at all**, or only into a draft a human then files through the ingest chokepoint? The tracked-change design works either way; the answer changes where the gate sits.
2. **Whose name is on an AI revision** — one platform identity, or the requesting member with a marker? The first is more honest and more defensible; the second is what opposing counsel will see and may invite a question the firm would rather not answer in that forum.
3. **Is accepting an AI revision an audited act** in its own right, or is the version cut the record? The transcript is already discoverable work product; the acceptance arguably should be too.
4. **Does ADR-0109's still-open client-consent decision have to be answered before 4b**, or do the two shipped Magnus gates cover a feature that reads and proposes against a client's document?

---

## 7. Sources

- [Get started with Claude Docs — Claude Help Center](https://support.claude.com/en/articles/16923645-get-started-with-claude-docs) — plan availability, default state per plan, the stated limitations, and the CMEK/ZDR/HIPAA exclusion.
- [Anthropic tries to make Claude stickier with launch of Docs and Slides — Computerworld](https://www.computerworld.com/article/4223177/anthropic-tries-to-make-claude-stickier-with-launch-of-docs-and-slides.html) — launch date, the rich-text editor, export formats, consumption billing.
- [Anthropic debuts Claude Docs, raising stakes for Microsoft — Axios](https://www.axios.com/2026/09/16/anthropic-claude-docs-microsoft) — positioning against Office.
- [Anthropic Targets Lawyers With Claude For Word — Artificial Lawyer](https://www.artificiallawyer.com/2026/04/11/anthropic-targets-lawyers-with-claude-for-word/) — the add-in's release and its legal framing.
- [Claude for Word Gives Lawyers Native Redlines From AI — Smith Stephen](https://www.smithstephen.com/p/claude-for-word-gives-lawyers-native) — the tracked-changes review model.
- [Claude for Word: What It Does and Misses for Legal Work — GC AI](https://gc.ai/blog/claude-for-word) — the confidentiality guidance and the prompt-injection warning.
- The block-addressable editing contract in section 2 and 4c was read directly from the Claude Docs agent-facing surface on 2026-09-18, not from a published document.
- [Collabora Online 22.05 release notes](https://www.collaboraonline.com/collabora-online-22-05-release-notes/) and [Send UNO command using postMessage — Collabora forum](https://forum.collaboraonline.com/t/send-uno-command-using-postmessage/1711) — the `Send_UNO_Command` host message (5b).
- [Collabora Online SDK — How to integrate](https://sdk.collaboraonline.com/docs/How_to_integrate.html) — `X-COOL-WOPI-Timestamp`, the 409 on mismatch, and the reload-or-overwrite behaviour on external modification (5b).
- [No supported way to set the author of a tracked change on 2.x — superdoc/docx-editor#3998](https://github.com/superdoc/docx-editor/issues/3998) and [MCP: attach to live Yjs collaboration rooms — #3568](https://github.com/superdoc/docx-editor/issues/3568) — the attribution gap (5b).
- [LibreOffice `docxattributeoutput.cxx`](https://docs.libreoffice.org/sw/html/docxattributeoutput_8cxx_source.html) and [W14.paraId — Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.linq.w14.paraid?view=openxml-3.0.1) — the paragraph identifier (5c).
