# Trust — PDF bank-statement import for three-way reconciliation

**Date:** 2026-08-14
**Scope:** Owner extension T10. Reading a bank statement the firm received as a **PDF** into the bank side of the trust reconciliation that already shipped. Design only — no schema, no route, no parser, no code of any kind.
**Status:** Proposed. Nine questions are flagged for the owner (section 9) and every one of them is a place where deciding would mean the platform legislating about a firm's money or a client's records.
**Feeds:** the reconciliation built under ADR-0246 — `packages/trust/src/{bank-statements,statement-import,matching,reconciliation,three-way-proof}.ts` and migration `20260805T200000_trust-reconciliation`. It does not replace any of it and changes nothing about what a reconciliation means.
**Inherits:** ADR-0214 (conversion of a firm's data is consensual and guided), ADR-0179 (the OCR engine, its model pin, and the honest limit of its determinism), ADR-0128 / ADR-0127 (the pure-Rust PDF core and the `hayro` doctrine), ADR-0182 (the PDF decompression guard).
**Related:** the white paper, _Trust accounting_ and _Performance and concurrency model_; the invariants in [`docs/conventions/invariants.md`](../conventions/invariants.md) and in [`packages/trust/CLAUDE.md`](../../packages/trust/CLAUDE.md).

---

## 1. What already exists, and what this actually adds

Three-way reconciliation is built. A `trust_bank_statement` holds the institution's own figures — period, signed opening and closing balances, a `source` of `entered` or `imported` — and `trust_bank_statement_line` holds one row per posted item. `computeTrustThreeWayProof` compares the bank's closing balance (adjusted for deposits in transit and outstanding disbursements) against the ledger's book balance and against the sum of every client ledger plus the firm's bank-charge cushion. `suggestTrustStatementMatches` ranks bounded candidates and matches nothing; a `trust_reconciliation_match` exists only because a member named both ends. Closing freezes the proof, balanced or not, and the migration's triggers refuse every further write.

A statement already reaches that table two ways. A member types it (`source = 'entered'`). Or a member imports a delimited file the firm exported from its bank: `previewTrustStatementImport` resolves a column mapping from the header row, reports every row it could read and every row it could not, and stores nothing; `confirmTrustStatementImport` re-parses the same text and refuses unless the fingerprint the preview returned still matches.

**What is missing is the file firms actually have.** Online banking hands a firm a PDF. The delimited export exists at most banks and is not where a member starts, and at some institutions — particularly the small local banks a solo practice uses for its trust account — it does not exist at all. So the practical state today is that a firm with a PDF statement types it, line by line, monthly, per trust account, into the one record a disciplinary body may later read.

**What this adds is one new producer of rows that already have a home.** Nothing downstream of the parsed rows changes: not the statement table, not the matcher, not the proof, not the close, not what a match means. That is the shape of the whole design and the reason it is small. Everything hard is upstream of the row.

---

## 2. The governing distinction

> A reconciliation records a disagreement between the firm and the bank. It must never record a disagreement between the bank and our reading of the bank.

Both are differences between two numbers and they are opposites in every way that matters. The first is the entire product: it is why reconciliation is a correctness feature rather than a report, and it is why `closeTrustReconciliation` freezes an unbalanced proof rather than refusing it — a close that refused would make the platform the judge of when a firm is allowed to have a problem. The second is a defect wearing the first one's face. A misparsed amount that lands in `trust_bank_statement_line` becomes, from that moment on, indistinguishable from the bank having said it. The proof will not balance, the firm will hunt for a trust discrepancy that does not exist, and if the misparse happens to be compensated elsewhere the proof will balance and certify agreement that was never proved.

Every judgement below follows from that sentence.

---

## 3. Hard part one — the confidence model

### 3.1 Two kinds of uncertainty, and only one of them has a number

**Character uncertainty** is the recognizer's: a `3` read as an `8`. It is real-valued, per line, and the engine already reports it (`TextLine.confidence` in `crates/ocr-core/src/facts.rs`). It exists only on the recognition path; a born-digital PDF's text layer carries the characters the author wrote, exactly.

**Structural uncertainty** is the parser's: which vertical band is the amount column, whether this line is a transaction row or a page footer, whether a wrapped second line of description belongs to the row above it or is a row of its own. No model produces a number for it. It is an inference about layout, and on a bank statement it is where the damage lives — a column misidentified once is a whole statement of amounts read out of the wrong place, and every one of them will be a well-formed number.

A single threshold over a recognizer's confidence score cannot see the second kind at all, and treating the first kind as the whole confidence model is how a design of this shape fails.

### 3.2 The statement carries its own checksum, and that is the confidence model

A bank statement is not an unconstrained document. It states an opening balance, a closing balance, and the items between them, and those figures are related by arithmetic the bank itself performed:

```
opening balance + sum(deposits) - sum(withdrawals) = closing balance
```

If the parsed rows foot to the parsed closing balance, then every amount and every direction the parser read is corroborated by two figures it read independently, from a different part of the page, under a different layout rule. A single misread digit breaks the footing by a power of ten. A misidentified amount column breaks it comprehensively. A dropped row breaks it by exactly that row. This is a stronger signal than any per-glyph confidence, it is arithmetic rather than a model output, and it is explicable to a bar auditor in one sentence.

Most statements print a **running balance** per line as well. Where the parser can read that column, the check localizes: the first line at which the running balance stops agreeing with the accumulated total is the line that was misread, which turns "this statement is off by $180" into "line 34 was read wrong."

**So the gate is arithmetic, not a score.** The recognizer's confidence is retained and used for exactly two things: ordering the member's review (least-confident rows first) and explaining a footing failure ("these three amounts were read at low confidence"). It never decides anything by itself, because a threshold on a confidence score is precisely the "silently do the sensible thing, it is usually right" default that ADR-0214 exists to refuse.

### 3.3 What the system does when it is unsure — refuse, stage, or record

All three, assigned by failure class, and never the fourth thing (import the row with a doubt attached and let it sit).

| Condition                                                                                              | Outcome                                                                                                                                                  | Why not something else                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The layout cannot be resolved — no column band reads as money, or no page reads as a transaction table | **Refuse the preview**, naming what was found (page count, the bands detected, whether text was native or recognized)                                    | This is `statement-import-columns-unrecognized` in the delimited importer, and it is right for the same reason: a positional guess at which column held the money is the one guess whose failure is invisible |
| The rows do not foot to the stated closing balance                                                     | **Refuse the import**, reporting the difference, the running-balance line where it first diverged when available, and the rows read at lowest confidence | This is the disagreement-with-our-own-reading case from section 2. It is not the firm's problem to record; it is ours, and recording it would make it the firm's forever                                      |
| One row is unreadable — an unparseable date, a missing amount, a figure in both money columns          | **Reject the row**, in the preview, with a reason and a page-and-line locator                                                                            | Exactly the delimited importer's `TrustStatementImportRejection`. A rejected row is typed in; a guessed row is a number nobody can trace                                                                      |
| Every row read and the statement foots                                                                 | **Report it and stop.** Storing takes the separate confirmation act that quotes the preview fingerprint back                                             | A footing statement is a statement we have no reason to doubt, which is not the same as a statement anybody approved. ADR-0214's opt-in rule is not conditional on the platform's own confidence              |

**Nothing is staged in a half-imported state.** A partially imported statement is a statement whose closing balance is unproven, and it would flow straight into a proof as a bank leg that nobody can reconstruct. The staging that this design does want is the whole preview: the report exists precisely so that "the system was unsure" is a screen a person reads rather than a column in a table.

### 3.4 The uncertainty is retained, on the row, as provenance rather than as a gate

Each stored line records how it was read — native text layer or recognition, the page and line it came from, and, on the recognition path, the confidence the engine reported and the model that reported it. That is not a score anything computes on. It is so that a member reading a reconciliation next year can tell a line transcribed exactly from a born-digital PDF from a line a recognizer read off a photocopy at 0.83, and so an auditor asking "where did this figure come from" gets an answer more specific than "a file."

---

## 4. Hard part two — may an imported line cause a movement?

**No. Never. Not with an approval step, not for an obvious bank fee, not behind a permission.** An imported statement line is only ever _matched against_ something the firm recorded. The prior in the brief is correct and the argument for it is stronger than a preference — there are four independent reasons, and the design would fail on any one of them.

**It has no client and no matter, and attribution is derived, never accepted.** A statement line says `DEPOSIT 5,000.00 REF 41221`. Nothing on it identifies whose money that is. The composition guard needs a matter leaf, and `ensureMatterTrustLeaf` derives the client from the matter's own client party and refuses `matter-has-no-client` rather than take a caller's word — because a caller naming a client beside a matter was once enough to file one client's money onto another client's ledger. A parsed line is a caller, and the least trustworthy one in the system.

**It would collapse the proof into a comparison of the bank statement with itself.** Book and client agree by construction while the guard holds; that leg is a re-proof of the guard, not a calculation. The bank leg is the _only_ independent input in the three-way proof and the only thing that can catch an item the firm never recorded. Let a statement line post an entry and the bank leg begins feeding the book leg. The proof would then balance more often — and the one signal that means "something reached the ledger without going through the composition guard" would be gone. A reconciliation that always balances is not a better reconciliation; it is a report.

**There would be no authorizer.** `trust_movement` carries `authorized_by` by table CHECK rather than by a composer remembering, money out of a client ledger runs through the two-person queue under the firm's stamped authorization-policy version, and every path there asks whether _this actor_ is in the counted set. A movement caused by a parse has no actor. It would have to be attributed either to the member who uploaded a file — who authorized no payment — or to the platform, and "the software authorized it" is the exact row a disciplinary body would ask about.

**It is a strictly larger authority than automatic matching, which is already refused.** The matcher deliberately offers no composer that takes a suggestion, because one would let a caller loop over the top candidate and the human confirmation would be gone with nothing in the module having changed. Posting from an import is that same door, wider.

**The structural answer is that nothing needs building to enforce this.** `trust_bank_statement_line` has no relation to the ledger. The only join between a line and an entry is `trust_reconciliation_match`, and that row exists only because a member named both ends. The PDF import contributes rows to a table that structurally cannot post. Keep it that way: no ledger identifier on the line, no "suggested entry" column, no consumer that reads lines and composes anything.

**The tempting case, named and answered.** An unmatched withdrawal that is plainly a monthly service charge, on a firm that has opened the bank-charge carve-out, invites a one-click "record this." The right shape is not an exception to the rule but a smaller thing that looks like one: the reconciliation surface may **pre-fill** the ordinary `composeTrustBankCharge` composer from the line, and the member submits it under their own identity, holding `trust:firmFunds`, producing an ordinary `trust_firm_funds_movement` that touches no client money — and then matches the resulting entry to the line by hand like any other. The import proposed a form; a person disposed. That is flag **S3**, because even the pre-filled form is a new path from a parse toward money and the owner should say whether it exists at all.

---

## 5. Hard part three — provenance

The test is blunt: **could a person, a year from now, re-derive every stored line from what was kept?** If not, the reconciliation is a number, not an audit artifact.

### 5.1 Re-running the extraction is not a substitute for keeping it

Recognition is **not** reproducible across machines, and the platform already says so: ADR-0179 narrowed the determinism claim from cross-architecture to server-canonical, because floating-point addition is not associative and SIMD reduction order differs between x86-64 and ARM64, so a marginal glyph may decode differently on different hardware. Model pins also move — the OCR design pins an exact artifact revision precisely because it will be superseded. Re-running recognition next year on a different fleet against a different pin is a fresh reading of the document, not a reconstruction of the one that was stored.

**So the extraction output is retained, not recomputed.** That is the single fact that shapes the retention list.

### 5.2 What is kept

1. **The original PDF, verbatim.** In the firm's own R2 bucket, content-addressed by digest, stamped with a new **firm-scoped** object class (the trust account spans matters, so this object belongs to none of them). It arrives through the ordinary ingest chokepoint and is malware-scanned like every other inbound file — there is no second upload door into the trust subsystem.
2. **The digest of those bytes**, on the statement row, so the statement points at exactly the bytes and a substituted object is detectable rather than assumed away.
3. **The extraction artifact** — the intermediate representation the parser consumed, as an R2 object beside the PDF (bulk content goes to R2, never D1). Per page, per line: the text, its geometry, whether it came from the native text layer or from recognition, and on the recognition path the confidence and the engine's own provenance triple (engine version, model version, platform). This is what makes re-derivation possible without re-running a non-reproducible engine.
4. **The parser's own version and the resolved layout profile**, on the statement row as values rather than as free text, because "which code read this" is a question asked when two statements parsed differently.
5. **The parsed rows**, which is what `trust_bank_statement_line` already is, plus a locator back into the extraction artifact — page index and line index, extending the delimited importer's `source_row_number`, which is a row number in a spreadsheet and means nothing for a PDF.
6. **The preview fingerprint the member confirmed**, and who confirmed it, so the record shows which report a person actually agreed to rather than merely that somebody clicked.

With all six, the chain runs end to end: these bytes, read by this code at this version, produced this text with this geometry, from which these rows were assembled, which this named person reviewed and confirmed on this date, and which foot to the closing balance printed on page 1. Every link is checkable without re-running anything.

### 5.3 What is deliberately not kept

No page images. Rasterization is an input to recognition, not evidence of anything the original PDF does not already carry, and page images of a client's bank statement are the single largest and most sensitive byproduct this path could accumulate.

### 5.4 The delimited importer retains nothing today, and that is a defect

`ConfirmTrustStatementImportInput.fileText` arrives in a JSON request body and is dropped once parsed. Nothing on the statement row identifies the file, and no copy of it exists. A statement already in a firm's database with `source = 'imported'` therefore **cannot be re-derived from anything the platform kept** — the strongest guarantee available is the fingerprint check, which proves the confirmed text matched the previewed text and then discards both. The retention mechanism designed here is not PDF-specific and should carry the delimited path too, in the same slice, so that `imported` means one thing rather than two. This is flag **S5**, because how long a client's bank statement is retained is not a decision this design gets to make.

---

## 6. Hard part four — matching

### 6.1 The algorithm is unchanged, and that is the point

A PDF-sourced line is a `trust_bank_statement_line` like any other, and `suggestTrustStatementMatches` is a pure function over lines and outstanding items. Restating what it does, because the failure modes are the interesting part:

**The bound comes first and is not a weight.** A candidate must have an amount **exactly equal** to the line's and a direction that corresponds — `bankDeltaMinor` positive for a deposit, negative for a withdrawal. Items outside a **45-day** window between the bank's posted date and the ledger's effective date are dropped. Everything surviving is a candidate; there is no score.

**Signals are reasons, not weights.** Each candidate carries the facts a person can check against the two rows in front of them: `amount-equal` always, then `same-day` or `within-window`, then `reference-equal` when both sides carry the same reference (a check number), then `counterparty-similar` when one normalized name contains the other and both are at least four characters. Candidates rank by signal count, then by absolute day gap, then by entry identifier — a stable tail so the same data always offers the same list in the same order, because a suggestion list that reshuffles between reads is one a member stops reading.

**Five candidates per line, and a person names both ends.** There is deliberately no composer that accepts a suggestion.

### 6.2 Failure modes

**Indistinguishable candidates.** Three $1,500 retainer deposits on the same day produce a fully symmetric candidate set: same amount, same day, no references, no names. The member picks one. The pairing is arbitrary; the aggregate is right, and the proof is aggregate — so the arithmetic is unharmed and the narrative is wrong. "Which client's deposit cleared on the 14th" now has a recorded answer that nobody actually knew. The design should **name this state rather than hide it**: when two or more candidates share every signal, the suggestion surface says so, so a member knows they are choosing arbitrarily rather than choosing. That is a display change and it stores nothing new.

**One bank line covering several recorded items.** A single deposit slip for three checks, or a bank that summarizes the day's deposits into one posting. Already a known gap: it reads as one match plus two items left outstanding, and the proof reports the resulting difference rather than hiding it. Honest, and for a firm that batches deposits it means a period that can never balance. PDF import makes it more common, because a summarizing bank summarizes on the statement it prints. Whether a match may be one line to N entries is flag **S4** — it changes what a match _means_, which is the owner's, and the one-to-one rule is currently enforced in the composer and re-proved by the fitness suite rather than by an index, so widening it is a change in three places.

**Bank-originated items with no ledger side.** A service charge, an interest credit, a returned deposit, a forged or duplicated check. There is no entry to match and there never will be until the firm records one. **Unmatched is the correct outcome and a first-class finding** — these are exactly the items the no-negative floor structurally cannot see, and surfacing them is what makes reconciliation a correctness feature.

**Ledger items with no bank side.** A deposit in transit or an outstanding check. Also first-class: they adjust the bank leg in the proof by construction, and the outstanding read has deliberately no lower date bound, so a check written two years ago and never cleared is still there.

**Aged items fall out of the suggestion window but not out of the proof.** The 45-day window bounds _suggestions_, not the outstanding list. A stale check is still counted and still matchable — by hand, with no suggestion to help. Correct, and worth saying in the user documentation so it does not read as a bug.

**An amount misread by recognition breaks matching rather than corrupting it.** Exact equality means a wrong digit produces no candidates at all, which is the safe direction — and the footing gate would have refused the import before the matcher ever saw the line.

### 6.3 What PDF import can genuinely contribute to matching

The running-balance column, where it exists, gives each line an independent per-line check. Beyond localizing a footing failure, it lets the parser assert the **order** the bank posted items in, which the delimited export often loses. That is a parse-side improvement, not a matcher change, and it stays on the parse side.

---

## 7. Hard part five — where the parsing runs

### 7.1 The composite shape, which the platform already uses

`apps/worker/src/search/text-extraction.ts` already answers this question for a different consumer, and its reasoning transfers exactly: read the document's own text layer first in pure Rust, decide **per page** whether recognition has anything to add, and send only those pages on. Per page rather than per document, because a scanned remittance advice stapled to a born-digital statement is one file with pages of both kinds, and either whole-document route loses half of it. The same `pdf-core` function decides on both sides, so the extractor and the recognizer can never disagree about a page.

So:

**Native text layer — in the Worker, as WASM, pure Rust.** `crates/pdf-core` over `hayro`, already compiled to WASM and already the platform's text-extraction answer, with the decompression guard and the page ceiling in front of it. Untrusted bytes are parsed by memory-safe code and nothing crosses into C++. This is the path virtually every statement takes, because a firm downloading a PDF from online banking gets a born-digital document.

**Recognition — in the OCR Container that already exists.** `apps/ocr-worker` over `containers/ocr`, network-isolated, holding the pinned model. Reached through the existing `OCR_SERVICE` binding. A 139 MB model and a rasterizer are not a request handler's work, and the platform already extracted this into a dedicated worker for exactly this class of load.

**Table reconstruction and money parsing — in TypeScript, in `@magna-carta/trust`.** Once positioned text has crossed the boundary it is plain structured data with no untrusted parsing left in it, and the assembly rules have to obey the money rules that already live here: `Money` in and `toMinor` integers at the SQL boundary, `isValidCalendarDate` as the one date check, the existing rejection vocabulary so a PDF row rejection reads like a delimited row rejection. Putting it in Rust would put the money rules in two languages.

**Not the browser, ever.** A client-side parse is a client-supplied row set. The delimited importer already re-parses server-side on confirm rather than trusting the preview it just returned, for exactly this reason.

### 7.2 The one thing `pdf-core` needs to expose

The geometry already exists and is not reachable. `crates/pdf-core/src/textpos.rs` observes a page's resolved draw sequence and produces glyph marks with bounding boxes; `textextract.rs` consumes that pass and throws the boxes away, returning lines of text in a **single-column** reading order that "interleaves its columns on each line" — which is fine for a keyword index and fatal for a table, where the whole question is which column a number sat in.

So the design's one Rust addition is a **positioned** extraction beside the existing one: the same observation pass, returning lines with their boxes rather than lines alone. It is an exposure of an existing internal capability rather than a new engine, it lands in the crate that already owns page interpretation, and it makes the native and recognition paths report the same shape — text plus geometry, with recognition additionally reporting confidence — so table reconstruction is one algorithm over one representation regardless of which side produced it.

### 7.3 No new dependency, and a deliberate refusal of the obvious ones

Everything named above is already in the tree under an existing decision: `hayro` (ADR-0127), `pdf-core` (ADR-0128), the decompression guard (ADR-0182), `oar-ocr` over `ort` with the C++ consent already granted and reasoned (ADR-0179), the `image` crate in the raster path. **This design proposes no new library.** Golden rule 11's obligation to verify current documentation is therefore satisfied by not incurring it, and golden rule 14 needs no new consent, because no new C or C++ surface is introduced and the existing one is unchanged: ONNX Runtime still sees only our own pinned model and a decoded pixel buffer, never the document.

That refusal is deliberate and worth stating, because the obvious move here is to reach for a PDF table-extraction library — and the mature ones are Python (`pdfplumber`, `camelot`, `tabula`, which is a JVM wrapper) or sit on `pdfium`, which is a large C++ PDF parser reading untrusted, privileged bytes. That is precisely the exposure golden rule 14 exists to prevent, and taking one would also mean a second PDF parser in a platform that deliberately runs one. A bank-API aggregator is refused on the separate ground ADR-0246 already took: no bank API integration, and an importer of a different format is just another producer of the same rows.

**Reading the statement with a model is refused, and this is the interesting refusal.** `@magna-carta/inference` exists, is ZDR-gated, and would read a messy statement better than geometry will. It is wrong here on three independent grounds. The output is not reproducible, so the audit chain in section 5 cannot close — and a reconciliation that cannot be re-derived is the thing this design exists to avoid. There is no arithmetic corroboration of a generated number: the footing check in section 3 works because the parser reads the closing balance from the page, and a model that produces both the rows and the balance can produce a self-consistent fiction. And a client's bank statement through a model is a confidentiality decision with a consent model attached, which is an owner question and not a parsing detail. If it is ever wanted, it belongs where its non-determinism is harmless: suggesting a layout profile that a person then confirms and that is thereafter applied deterministically. That is flag **S8**.

### 7.4 Keeping it off the hot path

The native path is a WASM call over a small document and stays synchronous, on the same budget the search extractor already runs under. The recognition path is a Container round trip over a rasterized document and does not belong in a request. It should ride the job shape the conversion subsystem already has — a coordinator Durable Object keyed to the firm, a queue, a poll endpoint and a WebSocket subscription resolving through one shared progress resolver — rather than growing a second job mechanism. The preview is the long-running act; the confirmation is fast, because it re-parses a retained extraction artifact rather than re-recognizing a document.

### 7.5 Layout resolution: geometry, plus confirmations that accumulate

The platform ships **no bank-specific knowledge**. There is no list of supported banks, because such a list is a maintenance burden that is silently wrong for the bank a firm actually uses.

Instead: columns are inferred geometrically — cluster line boxes into vertical bands, classify each band by what its cells look like (dates in one shape, currency amounts in another, free text widest), and require the footing check to pass before any of it is offered. Then ADR-0214's fourth rule does the rest of the work: **confirmations accumulate.** The first statement from a given institution asks the member to confirm the resolved column roles and the date convention; that confirmation is stored as a per-firm **statement layout profile**, keyed by a structural fingerprint of the layout rather than by a bank name (which is not reliably present in the file and is not a stable key), and next month's statement resolves against it with nothing to confirm. It is visible and editable, never an invisible cache — a stored profile that was wrong stays wrong until somebody can find it and fix it. This is the same mechanism as the document-automation field-mapping library, and it is the reason a monthly task does not become a monthly interrogation.

**The date convention is stated, never detected** — the delimited importer's rule, inherited verbatim, and it matters more here. `03/04/2026` is two different days on two sides of an ocean, and a reconciliation built on the wrong one is wrong in a way nobody notices. A profile may _remember_ a stated convention; nothing infers one from the data, because a file whose days all happen to exceed twelve would be read one way and the same bank's next file the other.

---

## 8. The flow, end to end

1. **Upload.** The member uploads the statement PDF through the ordinary ingest path. It is malware-scanned like every inbound file and lands in the firm's bucket, firm-scoped, stamped, content-addressed.
2. **Extract.** Native positioned text per page; pages the shared gate marks as scans go to the OCR Container. The result is the extraction artifact, retained in R2 with the recognizer's provenance where recognition ran.
3. **Preview.** The parser resolves a layout (from a stored profile, or by inference offered for confirmation), assembles rows, checks the footing, and **reports**: the resolved column roles, the period and balances it read, every row and what each would become, every row it could not read and why, the totals, and the footing result. **Nothing is stored** beyond what step 1 and step 2 already retained, and running it is not a decision to import anything. A layout it cannot resolve, or a footing it cannot make, is a refusal here that names what it saw.
4. **Confirm.** A separate, explicit act quoting the preview's fingerprint. The rows are re-derived from the retained extraction artifact and the fingerprint must still match, so a member cannot approve one reading and have another stored. This composes an ordinary `trust_bank_statement` with `source = 'imported'` and its lines, in one batch, through the existing composer — which already enforces the period bounds, the currency match, the positive-amount rule, and the line-inside-period rule.
5. **Report.** What was actually recorded, including how many rows could not be read — because the person who confirmed and the person who reads the result are frequently not the same person.
6. **Reconcile.** Unchanged from here on. Open a reconciliation against the statement, work the suggestions, name both ends of each match, and close — freezing whatever the proof said.

---

## 9. Flags for the owner

Numbered **S1–S9** as their own series, deliberately not extending the trust ledger's `T` numbering, so an answer to one of these can never be mistaken for an answer to a trust-accounting flag. Each is a place where building would mean the platform deciding something about a firm's money, its client's records, or what a reconciliation means.

**S1 — Is a footing failure a refusal, or a warning a member may override?** The design refuses: rows that do not foot to the parsed closing balance are not stored at all, and the member types the statement or fixes the file. The alternative is to import them with the discrepancy recorded, which is faster and puts a difference into the bank leg that nobody can attribute — the firm cannot tell whether it is a trust problem or a parse problem, and by the time it matters the file may be gone. **Recommended: refuse.** Say plainly whether a firm may override, and if so under what capability and with what recorded on the row.

**S2 — May a scanned statement be imported at all, or only a born-digital one?** Recognition is not reproducible across machines (ADR-0179), and this design compensates by retaining the extraction output rather than promising to re-derive it. That is a genuine mitigation and not a proof. A stricter posture — recognition may _assist_ a member typing a statement, but only a native text layer may produce stored lines — is defensible and costs the firms with paper statements the most. **Recommended: allow it, with the extraction retained and the source recorded on every line**, so a reader can always see which lines came from a recognizer.

**S3 — May the reconciliation surface pre-fill a bank-charge composer from an unmatched line?** No import ever posts (section 4). But the monthly service charge is real, it is the commonest unmatched withdrawal, and offering the member a pre-filled `composeTrustBankCharge` that they submit under their own identity is a convenience that touches no client money — the firm-funds category has no client, matter, node, or payee column, so it structurally cannot describe somebody else's money. It is still a new path from a parse toward a movement. **Recommended: allow it, for the firm-funds category only**, never for a client disbursement or deposit.

**S4 — May one statement line match more than one ledger entry?** A single deposit slip covering three checks is a real shape the current model does not express: it reads as one match plus two items outstanding, and the proof reports the difference. For a firm that batches deposits that is a period that can never balance. Widening it changes what a match means and touches the composer, the fitness re-proof, and the outstanding read. **No recommendation** — this is the one flag where the honest answer is that the cost of the current behaviour depends on how the owner's firms actually deposit.

**S5 — How long is the source statement PDF retained, and what may erase it?** It is a client's bank account activity: names in descriptions, amounts, dates. Keeping it is what makes the reconciliation reproducible; deleting it degrades the chain. The design keeps the extraction artifact and the parsed rows independently, so deletion of the PDF degrades rather than breaks. Two sub-questions the owner owns: does retention run to the jurisdiction's trust-record retention period, and does a subject erasure request reach a trust bank statement while that obligation runs? **Recommended: retain for at least the trust-record retention period; treat the statement as out of reach of subject erasure while that period runs, and say so in the erasure registry rather than leaving it to be discovered.**

**S6 — Does the retention mechanism apply retroactively to the delimited import?** Today a delimited-imported statement retains nothing (section 5.4). Fixing it forward is cheap and makes `source = 'imported'` mean one thing. Fixing it backward is impossible — those files are gone. **Recommended: apply it forward in the same slice, and accept that statements imported before it cannot be re-derived** rather than implying they can.

**S7 — Does importing a statement need its own capability?** It ships under `trust:manage` today, alongside opening accounts and composing movements. Recording the bank's own figures is arguably a bookkeeping act that a member who may not move a dollar should be able to do — and arguably the opposite, since the bank leg is the input the whole proof rests on. **Recommended: keep it on `trust:manage` for now** and revisit if a firm asks; a capability added later is easier than one taken away.

**S8 — May a model ever read a bank statement?** Refused in this design on three grounds (section 7.3), and the narrow form that survives all three is a model _suggesting a layout profile_ that a person confirms and that is thereafter applied deterministically. **Recommended: not now, and if ever, only in that narrow form**, with the client-consent model settled first — which is itself still open.

**S9 — Does an imported statement need a second person before it can be reconciled against?** Money out of a client ledger can require two people under the firm's authorization policy. The bank leg of the proof is arguably as consequential and currently requires one. **Recommended: no** — the statement is the bank's assertion rather than the firm's, the close is already an attestation by a named member, and adding a second signature to an import would make the monthly task harder without making the record truer. Flagged because it is a control question and controls are the owner's.

---

## 10. Deliberately not in this design

1. **A bank API or aggregator.** ADR-0246 already refused it and nothing here reopens it. Another format is another producer of the same rows.
2. **Statement-driven anomaly detection.** "This fee looks unusual" is the platform asserting something about the firm's conduct on a record a disciplinary body may read, which is the posture the unclaimed-funds path already refuses on the same reasoning.
3. **Automatic matching, in any form, including a confidence-gated one.** Unchanged and not reopened.
4. **Multi-currency statements and multi-account statements in one PDF.** A combined statement covering an operating and a trust account on the same pages is real. Splitting one is a different problem, and guessing which pages belong to the trust account is exactly the class of guess this design refuses elsewhere. Refuse the file, naming what was found.
5. **User documentation.** It lands with the interface. A guide to a surface a firm cannot reach tells them the platform supports something it does not.
