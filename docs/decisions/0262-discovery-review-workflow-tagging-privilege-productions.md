---
number: 262
slug: discovery-review-workflow-tagging-privilege-productions
status: Proposed
date: 2026-08-07
area: Discovery
summary: "REVIEW IS A FUNCTION OVER THE CORPUS, AND ITS RECORD IS THE PRODUCT: discovery 5·2 designs tagging and coding, privilege review, and productions out — tagging first by owner direction. CODING IS GROUPS CONTAINING TAGS, two levels and no deeper: a single-choice group is the mutually exclusive choice review coding is actually made of (flat tags cannot say 'responsive XOR non-responsive', arbitrary trees buy depth nobody at this scale uses), and MACHINE LOGIC READS SEMANTICS, NEVER NAMES — a closed semantic vocabulary on tags drives the privilege log, production membership, and QC, so renaming a label can never change behavior. TAG STORAGE IS ONE ROW PER DOCUMENT PER APPLICATION, ALWAYS — family and bulk are recorded gestures that write per-document rows, never inherited at read time, because inheritance resolved years later at production time is where a bug produces a privileged document. Rows are NEVER DELETED: removal is a state with an actor and an instant, single-choice is a partial unique index rather than a guard, and bulk operations freeze their selection to R2 at initiation and undo by exact compensation — remove precisely the rows your event applied that still live, touch nothing anyone else did. Coding attaches to the dedup PRIMARY and reads through to occurrences, and the load file carries every occurrence's record custodian, which is 'which custodians held this' answered at the moment it is asked under oath. PRIVILEGE IS A TAG PLUS A CLAIM, deliberately both: designation stays uniform with all coding (one panel, one bulk path, one audit), while the claim carries what a tag cannot — multiple bases and the log description — and the LOG GENERATOR IS STRUCTURALLY UNABLE TO READ DOCUMENT CONTENT: its inputs are the claim, the tag rows, and the extracted metadata, never the text object. A PRODUCTION IS EVIDENCE OF WHAT WAS PRODUCED: membership frozen to explicit rows at staging, Bates drawn as a guarded BLOCK from a per-(matter, prefix) register by widening @magna-carta/sequence-numbering with an increment-by-N (one mechanism, not a drifting second counter), rendering on its own DISCOVERY_PRODUCE lane with the rasterize-route burn and a fail-closed verification gate, five-digest hashes on every artifact, and a cut production IMMUTABLE FOREVER — clawback is a new recorded fact on a member, never an edit, and the Bates numbers stay burned because they were served. PRODUCTION TEXT FOR A REDACTED DOCUMENT DERIVES FROM THE REDACTED ARTIFACT OR IS OMITTED — the pre-redaction extraction never reaches the production writer, because handing original text beside a redacted image is a redaction failure by sidecar. Withheld-privileged documents appear on the frozen per-production log and never in the volume. Production artifacts are RECORDS UNDER THE DISCOVERY PREFIX, not File Manager files — which is also what keeps them structurally outside the AI Search feed, whose only producer remains committed working-document text; 5·2 adds no producer, asserted by a fitness test. The per-review-set ACCESS LIST that 5·1·2 named ships with the first surface that renders it, every content read re-authorizes at read time through the existing file-manager and email paths, and walled review sets are absent, not hidden. Four owner flags stay open: the privilege-coding permission tier, Bates and slipsheets for withheld documents, the family-split default, and the privilege-log delivery format."
---

**Discovery 5·2 — the review workflow: coding as grouped tags with machine-read semantics and an
undeletable per-document audit; privilege as tag-plus-claim generating a content-blind log;
productions as immutable frozen selections with block-drawn Bates; tagging first.**

**Context:** 5·1 built the corpus (review sets, loads, version-pinned review documents, record
custodians) and the engines (extraction core, redaction, Bates stamping, five-algorithm hashing)
precisely so review could be functions over one object. The owner directed tagging first. The owner
docket fixed the UI label "Custodian of Record" (D1), ratified D5–D10, and ruled (F4b) that any
surface which could sweep assistant transcripts into a corpus carries an explicit include/exclude
control. The AI Search design forbids review sets from ever reaching the derived text feed, by
construction rather than by flag.

**Decision:** As proposed in
[`docs/specs/2026-08-07-discovery-5-2-review-workflow.md`](../specs/2026-08-07-discovery-5-2-review-workflow.md)
(spec plus slice plan, tagging in sub-slice 5·2·1), summarized above. Sub-slice order: coding and
the access list; privilege claims and the draft log; redaction drawing; productions; batches and QC
sampling; review aids and the transcript lane under F4b.

**Open owner flags (each with a recommended default in the spec):** **P1** — whether privilege
coding needs its own permission tier (recommended no: `discovery:review` codes, `discovery:produce`
is the consequential gate). **P2** — withheld-privileged documents and Bates (recommended: no Bates
consumed, no slipsheets by default, per-production slipsheet option). **P3** — the default when
privilege splits a family (recommended: produce non-privileged members, withhold privileged ones,
log records the family relationship; whole-family withholding as the per-production alternative).
**P4** — privilege log delivery format (recommended: CSV plus printable text, JSON alongside).

**Consequences:** The review surface arrives with its wall enforcement (the per-review-set access
list) rather than before it; every coding decision, bulk gesture, staging, cut, and clawback is a
recorded act a meet-and-confer can be answered from; `@magna-carta/sequence-numbering` gains a block
draw rather than discovery growing a second counter; and the platform's dedup, redaction, Bates, and
hashing engines acquire the workflow that assembles them into deliverables. Builds on ADR-0134
(rasterize redaction), ADR-0142 (Bates overlay), ADR-0143 (integrity hashing), ADR-0052/ADR-0196
(absence-not-existence), and the 5·1 review-set decisions.
