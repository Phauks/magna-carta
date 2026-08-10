# Translation services — design

**Date:** 2026-08-10
**Status:** Design proposed. The owner flags in section 8 are open; **slice 1 is buildable on the
recommended defaults** and depends on nothing that is not already shipped. No product code, no schema
migration, and no engine adapter in this cycle.
**Scope:** A translation capability for the platform — pasted text and uploaded documents, the
extraction and conversion path a scanned PDF needs before it can be translated at all, the aligned
side-by-side artifact and its printable rendition, the provenance record that says what produced the
translation and when, where a translated document lives relative to the document it came from, and
which engine may see a privileged document under which consent.
**Excludes:** spoken-word interpretation of any kind (a courtroom interpreter is a person, not a
feature); translation memory, glossaries, and term bases; multilingual user interface localization of
the product itself; any automated judgement of translation quality; and — unless owner flag T3 is
answered yes — any artifact that a reader could mistake for a certificate of translation accuracy.
**White-paper home:** _Core domain_ (documents and automation), with _AI / inference_, _Tenancy and
data isolation_, _Authentication, access control & encryption_, _Settings & configuration_, and
_Observability & diagnostics_ as the surrounding context.
**Governing decisions:** ADR-0003 (tenancy and the firm-scoped data-access layer), ADR-0017 / ADR-0038
(audit and redact-by-default), ADR-0039 (nothing heavy on the hot path), ADR-0067 (route metadata and
the one enforcement chokepoint), ADR-0068 (trusted-insider access control), ADR-0076 (the design
system), ADR-0101 (the Tools layer), ADR-0109 (client consent for third-party frontier processing —
**Proposed, still open**), ADR-0110 (confidentiality posture and the residual-retention disclosure),
ADR-0111 (`@magna-carta/inference` is the one credential-less chokepoint).
**Decision inputs:** the owner's sketch of 2026-08-10 — _"allow for pasting in of text for translation,
as well as uploading of pdf's and docx, which may require ocr, conversion to docx, and the ability to
add certain things to the documents, an audit report for translation that shows technology and date
used, side by side translation, printables."_ The shipped seams this design rides:
`packages/search/src/extraction.ts` and `apps/worker/src/search/text-extraction.ts` (composite
native/OCR per-page extraction), `packages/conversion/src/port.ts` and the LibreOffice container,
`apps/worker/src/conversions/conversion-coordinator.ts` (the job Durable Object shape),
`packages/document-assembly/src/ooxml/package.ts` and `assemble.ts` (OOXML generation),
`packages/object-dimensions/src/dimensions.ts` (the matter and object-class dimensions),
`packages/file-manager/src/file-statements.ts` (R2 key derivation and versioning),
`packages/inference/src/{port,catalog,settings}.ts` (the gateway chokepoint and the consent axis),
`packages/magnus/src/{settings,disclosure}.ts` (the two-gate consent pattern and the versioned
disclosure), `packages/ai-detection/src/settings.ts` (the feature-specific consent axis beside the
general one), and `packages/tools/src/types.ts` (the Tools manifest).
**Legal sources:** 8 CFR 103.2(b)(3); 8 CFR 1003.33 and the EOIR Policy Manual certificate-of-
translation appendix; Fed. R. Evid. 604 and Fed. R. Civ. P. 43(d); NRS 50.054 and NRS 1.510 / 1.520;
the Eighth Judicial District Court Rules as published by the Nevada Legislature.

---

## 1. The verdict in one paragraph, before any of the design

This fits, it is genuinely useful, and almost all of it rides seams the platform already has. One part
of the owner's sketch is dangerous and has to be reshaped before it is built: **"an audit report for
translation that shows technology and date used" is one word away from a certificate of translation
accuracy, and the two must never be confusable.** A certificate of accuracy is a human being's signed
attestation that they are competent in the language pair and that the translation is complete and
accurate. No machine can hold either half of that, and a document that recites an engine name and a
date next to a heading like "Translation Certificate" will be filed by somebody, somewhere, as though
it were one. So the artifact is built — refusing to build it just means a paralegal builds a worse one
in Word — but it is a **provenance record**, it says what the process was and never what the output is
worth, it carries an explicit statement that it is not a certification, and a fitness function over the
renderer's own strings keeps it that way. Everything else in the sketch is a straightforward composition
of the extraction, conversion, assembly, job, and storage machinery that is already running.

---

## 2. The legal reality

### 2.1 Three different things that all get called "translation"

**Machine translation** is engine output. Nobody has read it. It is evidence of nothing except that an
engine was run, and it is not admissible, filable, or submittable on its own anywhere in this design's
scope.

**Human translation** is a rendering produced or reviewed by a person competent in the language pair.
It is better, and it is still just a document — there is no attestation attached, so a court or an
agency has no one to hold to it.

**Certified translation**, in United States practice, is a human translation plus a signed
**certificate of accuracy**: a short statement in which a named person declares that they are competent
to translate from the source language into English and that the attached translation is a complete and
accurate rendering of the attached original. That is the whole of it. There is no government-issued
translator licence in the United States, no register, and no requirement of notarization in the
governing federal regulation. Certification is an _act by a person_, not a status conferred on a
document.

**Sworn translation** is a civil-law concept — a translator appointed and sworn by a state, whose seal
carries official weight — and **it does not exist in United States practice**. Product language must
never use the word. A firm that reads "sworn" on a platform screen and repeats it to a client has been
misled by us.

### 2.2 What the certificate actually contains, and who signs it

The federal immigration standard is the most precisely written and is the one most firms will be
producing for, so it is the reference shape. **8 CFR 103.2(b)(3)** requires that any foreign-language
document submitted to USCIS be accompanied by a full English translation which **the translator has
certified as complete and accurate**, together with **the translator's certification that he or she is
competent to translate from the foreign language into English**. **8 CFR 1003.33** imposes the
equivalent requirement in immigration court, and the EOIR Policy Manual publishes a certificate-of-
translation form for it.

Reduced to elements, a certificate of accuracy carries:

1. The **translator's name**, and enough identifying detail to reach them (address or affiliation).
2. A **competence declaration** in the specific language pair, in the first person.
3. An **accuracy and completeness declaration** covering the specific attached document.
4. An **identification of the document** the certificate is attached to.
5. A **signature and date**.

Notably absent: any mention of tools, engines, or methods. The regulation does not care how the
translation was produced. It cares that a person takes responsibility for it.

### 2.3 Can machine output ever carry that certificate?

**The output can. The machine cannot.** Nothing in 8 CFR 103.2(b)(3) prohibits machine-assisted
drafting, and a competent human translator may run an engine, review its output line by line, correct
it, and then sign the certificate — at which point the certificate is true, because a competent person
has read the whole thing and is standing behind it. USCIS's practical posture, and the profession's, is
consistent with that and hostile to the shortcut: raw machine output submitted with no human signer
fails the regulation on its face, because there is no translator to certify anything; a certification
naming a translation engine as the certifier is not a certification. The American Translators
Association's guidance is the same in substance — machine translation without professional post-editing
is not offered as certified work, and the signer bears responsibility regardless of the tools used.

The design consequence is exact and it is the spine of everything below: **the platform may generate a
translation and may describe how it generated it, and only a named human being may certify it.** Those
are two different artifacts, produced by two different acts, and the second one is owner flag T3.

### 2.4 Courts — federal and Nevada

**Federal courts.** Fed. R. Evid. 604 treats an interpreter as an expert: the interpreter must be
qualified and must give an oath or affirmation to make a true translation. Fed. R. Civ. P. 43(d)
governs appointment and compensation. Rule 604 is written for live interpretation, but the principle
carries to documents through the ordinary authentication rules: a translated exhibit is admitted on the
testimony or declaration of the translator, describing their qualifications and vouching for the
accuracy of the rendering. The practical enforcement is blunt — untranslated foreign-language material
is routinely disregarded on summary judgment, and material a district court accepted without a
translation cannot be considered on appeal. In the Ninth Circuit the sharpest line of authority is
about foreign-language recordings and their English transcripts, where the court has been explicit that
treating the foreign-language original as the controlling item in front of an English-speaking jury is
incoherent. What the practitioner needs, in every one of those situations, is **a human declarant** —
which is the same conclusion as section 2.3, arrived at from the other direction.

**Nevada.** NRS 50.054 sets the eligibility of an interpreter for a person with limited English
proficiency and the oath they take — to interpret accurately and make a true interpretation. NRS 1.510
and 1.520 charge the Court Administrator with the certified-court-interpreter programme and the Code of
Professional Responsibility that governs it. Those provisions are about **interpreters, not documents**.

A finding worth stating because its absence will otherwise be read as an oversight: **the Eighth
Judicial District Court Rules, as published by the Nevada Legislature, contain no express rule
governing foreign-language documentary exhibits.** The only interpreter-adjacent provision is
administrative — EDCR 1.50(c), directing the Court Executive Officer to supervise the Court Interpreter
Program. That is not permission to file untranslated exhibits. It means the requirement in Nevada state
practice comes from the evidence rules and ordinary authentication practice rather than from a local
filing rule, so the practitioner still needs an attesting declarant and has no local-rule checklist to
work from. A product that hands them a clean human-signed certificate is doing real work; a product
that hands them a machine-generated document titled "certificate" is handing them a sanctions risk.

### 2.5 What the provenance artifact may claim, and what it may not

This is a hard boundary in the product, not a style preference.

**It may state, because each is a fact about the process that the platform observed:**

- the **source document**: file name, byte count, SHA-256 of the exact bytes translated, page count;
- the **extraction route, per page**: `native` (the document's own text layer, read exactly) or `ocr`
  (a recognizer's reading of a picture of the page), with the recognition engine and model version for
  the OCR pages — the composite extractor already computes this and the distinction is meaningful to a
  reader deciding how much to trust the input;
- any **format conversion** performed before extraction, naming the converting engine and version;
- the **translation engine**: provider, model identifier, pinned model snapshot, and where it ran
  (on-Cloudflare, or a named third-party provider through the gateway);
- **source and target language**, and whether the source language was declared by the operator or
  detected;
- the **segment count**, and the count of segments the engine returned empty;
- the **date and time in UTC**, the **firm**, the **operator** (the member who ran it), and the **matter**
  if one was named;
- whether **any human edited** the output after generation, who, and when — including "no human edited
  this output", stated affirmatively rather than left as an absence;
- the **platform build** that produced the record.

**It may not state, in text, in a heading, in a filename, or by layout:**

- the words **certificate**, **certified**, **certification**, **sworn**, **attested**, **notarized**,
  **official**, **verified**, or **court-ready**;
- that the translation is **accurate**, **complete**, **true**, **faithful**, or **correct**;
- that it is **accepted by** or **compliant with** USCIS, EOIR, any court, or any agency;
- a **quality score**, a confidence percentage, or any number a reader could take for an accuracy
  measure;
- a **signature block, seal, stamp, notary jurat, or ruled signature line** — a blank line above a
  printed name is an invitation, and a document that invites a signature is a certificate with the
  signature not yet applied.

**It must state, verbatim and unavoidably, on every rendition:** that the document is a record of how a
machine translation was produced; that it is **not** a certificate of translation accuracy and not a
certification of any kind; that no person has attested to the accuracy or completeness of the
translation; and that a filing or submission requiring a certified translation requires a competent
person to review the translation and sign a certificate of their own.

**Naming.** The artifact is a **Translation Provenance Record**. It is never called an audit report
either — "audit" is a word this platform uses for its own access and event auditing, and reusing it
here would collide with a term that already has a home.

**Enforcement, not documentation.** The prohibited-claim vocabulary lives in one module beside the
renderer, and a fitness function scans the renderer's string table and its templates against it, in the
same spirit as the shipped source-scan fitness functions. A prohibition kept only in a design document
is a prohibition that survives exactly until the first person who has not read it edits the template.

---

## 3. The confidentiality posture

### 3.1 The standing posture this inherits

The platform's position is settled and this design does not get to re-answer it. Firm content does not
reach a third-party frontier model without an explicit, fail-closed, per-firm opt-in
(`inference.aiProcessingEligibility`, default `false`, in `packages/inference/src/settings.ts`), and
each AI feature carries its own gate beside that general one rather than instead of it — the pattern
shipped in `packages/ai-detection/src/settings.ts` and argued at length in the Magnus design's consent
section. Every model call goes through the one credential-less chokepoint,
`@magna-carta/inference`, whose curated catalog refuses a reasoning model that is not
zero-data-retention-eligible at module load.

### 3.2 The three engine options, compared honestly

**(a) Cloudflare Workers AI — `@cf/meta/m2m100-1.2b`.** As of this design's date this is the **only**
model in the Workers AI translation task category. It is Meta's 1.2-billion-parameter many-to-many
multilingual encoder-decoder. Confidentiality is the strongest available: it runs on the same
Cloudflare platform the product already runs on, no third party is involved at any point, and
Cloudflare's published position on Workers AI is that customer content is not used to train models,
inference requests are processed and discarded rather than retained, and inference data is not shared
between customers. That is the same boundary the platform's shipped embedding model already sits
inside, and the catalog entry for that model records exactly that reasoning.

The honest cost is quality. A 1.2B general-purpose many-to-many model is a _gist_ engine. It is weak on
legal register, weak on terminology consistency, weak on the long-context coherence a contract needs,
and it works in short spans, which means a long document is many independent calls with no shared
context between them. It is genuinely useful for "what does this letter say" and genuinely unsuitable
as the draft a human certifier starts from.

**(b) The shipped AI Gateway seam — a frontier model through `@magna-carta/inference`.** Translation
is a text-generation task and `generate` already exists; the catalog is already restricted to
ZDR-eligible models; the gateway is already configured with caching off and log collection off; the
fail-closed ZDR guard already runs before dispatch; and token usage is already captured from the
response for metering. Quality on legal text is in a different class from (a) — register, terminology,
and structure preservation are the things frontier models are good at. The cost is categorical: this is
a **third-party provider**, so ADR-0109 and the general consent gate apply in full, and the disclosure
has to say so in the words the Magnus design fixed.

**(c) Third-party translation APIs — DeepL, Google Cloud Translation, Azure Translator.** Their
published data handling, stated as what each vendor says rather than as verified fact:

- **DeepL** — on paid API plans the vendor states that submitted texts are deleted immediately after
  translation and are not used for model training, with a documented exception permitting automatic
  retention of content for up to 72 hours for debugging, encrypted and then deleted. A data-processing
  agreement is available and signable on paid plans.
- **Azure AI Translator** — Microsoft states a no-trace policy for text translation: submitted content
  is processed without being written to persistent storage, and is not retained for model improvement.
- **Google Cloud Translation** — the data-usage documentation distinguishes the Basic and Advanced
  APIs and the global versus regionalized endpoints; data location can be constrained on regionalized
  Advanced endpoints and cannot be on the global endpoint. Retention of operational logs and
  aggregated analytics is separate from retention of the translated content itself.

**Recommendation: refuse (c), for now.** Not because any of the three is careless — DeepL's and
Azure's stated postures are good — but because adopting one buys quality that (b) already delivers
while adding a fourth data processor to the privilege chain, a credential lifecycle the platform has
deliberately not built (the BYOK credentialed adapter is a named deferred seam in
`packages/inference/CLAUDE.md`), a per-release verification obligation on a second vendor's terms, and
a second place where a misconfiguration sends a client's document somewhere nobody intended. Golden
rule 1 argues the same way from the other side: the chokepoint exists, and routing around it is how a
chokepoint stops being one. If a firm's own engagement terms specifically name DeepL, that is exactly
the deferred BYOK adapter, and it is that slice's problem, not this design's.

### 3.3 The recommended posture, stated as gates

Three settings, all `FirmSettingDefinition`s in the per-firm `setting` table, all fail-closed, read at
the route before anything is enqueued and re-read in the consumer before the engine call — the shipped
shape, unchanged:

```
translation.enabled                  boolean, default false   the feature gate
translation.frontierEngineEnabled    boolean, default false   the frontier-route gate
inference.aiProcessingEligibility    boolean, default false   already shipped; the general gate
```

- **The on-Cloudflare route requires `translation.enabled` only.** It does **not** additionally require
  `inference.aiProcessingEligibility`, for the reason the AI Search design gave for the same question:
  that gate asks whether firm content may reach a **third-party frontier model**, and this route sends
  content to none. Requiring it would conflate two different questions and would deny an on-platform
  feature to precisely the most conservative firms, who are the ones the on-platform path exists for.
- **The frontier route requires all three.** `translation.frontierEngineEnabled` is a separate axis from
  `translation.enabled` because they are genuinely different decisions: a firm may reasonably want the
  gist engine for reading incoming correspondence and want nothing sent to a frontier provider. One
  boolean cannot express that, and collapsing them fails badly in both directions.
- **Member level:** an RBAC permission `translation:translate` in the shipped registry, enforced at the
  one chokepoint — never a parallel per-member boolean. Plus a **versioned member acknowledgement** on
  the Magnus `disclosure.ts` pattern, and — this is the departure from Magnus — **required for both
  routes, not only the frontier one.** Magnus requires a member acknowledgement because content leaves
  the platform. Here there is a second reason that applies even when nothing leaves: the member has to
  be told, before their first run, that what they are about to produce is machine output and is not a
  certified translation. That sentence is the whole legal spine of section 2, and the person who needs
  to read it is the person typing.

The **engine actually used is recorded on the run** and printed in the provenance record. A firm that
later has to answer "what saw this client's document" gets an answer per run, not a policy statement.

### 3.4 What the firm and the member are told

The firm-administrator disclosure at enablement states: which engine is in effect and where it runs;
for the on-Cloudflare route, that no third-party model provider is involved and that Cloudflare's
published position is that inference content is not retained beyond request processing and is not
trained on; for the frontier route, everything the Magnus disclosure requires, including the
ADR-0110 residual-retention sentence verbatim; that the gist engine is a gist engine and the
platform says so rather than letting the firm discover it; that translations and their provenance
records are kept as firm records under the matter; and that whether the firm's own engagement letters
and jurisdiction permit any of this is the firm's judgement and not the platform's.

The member acknowledgement states, in plain language: what the engine is; that the output can be wrong
in ways that read fluently; that it is **not a certified translation** and may not be filed or submitted
where one is required; and that the provenance record describes how the output was made and says nothing
about whether it is right.

---

## 4. What already exists, and what is genuinely new

### 4.1 The reuse map

| Part of the feature                               | Existing seam it rides                                                                                                                                                                                                                                                                                                                  | New code                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Upload of a PDF/DOCX                              | the shipped inbound-upload and untrusted pipeline; `packages/file-manager/src/ingest-core.ts`, the scan worker and its verdict path                                                                                                                                                                                                     | none                                                      |
| Deciding whether a PDF is born-digital or scanned | `apps/worker/src/search/text-extraction.ts` — the **composite** extractor, which already decides **per page** and returns `PageProvenance` with `native`/`ocr`                                                                                                                                                                          | none                                                      |
| OCR of the scanned pages                          | the OCR container behind `TextExtractionPort` (`packages/search/src/extraction.ts`)                                                                                                                                                                                                                                                     | none                                                      |
| Conversion to DOCX, and DOCX to PDF               | `packages/conversion` (`ConversionPort`, the registry, the format pathfinder) and the LibreOffice container                                                                                                                                                                                                                             | none                                                      |
| Job orchestration and progress                    | the shipped job shape: a queue message, a Durable Object per job keyed `firmId:jobId`, a poll endpoint and an events endpoint — `apps/worker/src/conversions/conversion-coordinator.ts` (`ConversionJob`), with `BundleBuildCoordinator`, `SearchIndexJob`, and `RecoveryJobCoordinator` as the other three instances of the same shape | a `TranslationJob` Durable Object, structurally identical |
| Generating the side-by-side document              | `packages/document-assembly` — `ooxml/package.ts` (`readPackage` / `writePackage` / `writePartText`) and `assemble.ts`                                                                                                                                                                                                                  | a platform-owned two-column template and its merge data   |
| The printable                                     | the DOCX→PDF edge in the conversion registry, through LibreOffice                                                                                                                                                                                                                                                                       | none                                                      |
| Where artifacts live in R2, and their scope       | `packages/object-dimensions/src/dimensions.ts` — `MATTER_DIMENSION` and `OBJECT_CLASS_DIMENSION`, server-derived and stamped at put time                                                                                                                                                                                                | two new members of the object-class unions                |
| Filing a translation as a document                | `packages/file-manager/src/file-statements.ts` key derivation and the version chain                                                                                                                                                                                                                                                     | a typed derivation link                                   |
| The matter-free tool surface                      | `packages/tools/src/types.ts` `ToolManifest` and the two-surface shell; the `files` subject group                                                                                                                                                                                                                                       | one manifest entry                                        |
| Consent settings and the acknowledgement          | `FirmSettingDefinition` via `data-access/setting-statements`; `packages/magnus/src/disclosure.ts` for the versioning discipline                                                                                                                                                                                                         | two definitions, one constant, one table                  |
| Reaching a frontier model                         | `@magna-carta/inference` — `generate`, the ZDR guard, the gateway options, response-captured usage                                                                                                                                                                                                                                      | none                                                      |
| Cost accounting                                   | the shipped `token_usage_meter` path (`packages/data-access/src/token-usage-statements.ts`)                                                                                                                                                                                                                                             | none                                                      |
| Audit                                             | the standard audit pipeline; `packages/magnus/src/audit.ts` as the nearest precedent for auditing that a run happened without recording its content                                                                                                                                                                                     | none                                                      |

Two of those deserve a sentence more.

**The composite extractor is the single best piece of reuse in this design, and translation is the
consumer it was waiting for.** `packages/search/src/extraction.ts` already returns, per page, whether
the text came from the document's own layer or from a recognizer — and its own comment records that
nothing persists that today: the distinction is _produced correctly and then discarded_, a forward seam
with no reader. The provenance record is the reader. A translation of a scanned page is a translation
of a machine's guess at what the page said, which is a materially different thing from a translation of
the characters the author typed, and the record must say which pages were which. This design does not
add extraction machinery; it adds the first consumer with a reason to store what extraction already
knows.

**The side-by-side artifact is a document-assembly job, not a new renderer.** A two-column
source/target layout is a WordprocessingML table with one row per segment — that is a template plus
merge data, which is precisely what `assemble.ts` does, over the OOXML part map `ooxml/package.ts`
already reads and writes. The rejected alternative is composing a PDF directly with `packages/pdf`: its
exports are page-level operations — Bates stamping, watermarking, redaction, forms, merge, split,
rotate, text extraction — and it has **no text-layout engine**, so paragraph flow, column balancing,
and pagination would all be new machinery built beside a DOCX pipeline that already produces PDFs
through LibreOffice. Generating DOCX and converting has a second advantage that decides it: the DOCX is
**editable**, and the human-review path in slice 4 needs an editable draft, which the platform can
already open in Collabora.

### 4.2 What is genuinely new

1. **`@magna-carta/translation`** — a pure package holding `TranslationPort`, the segment model, the
   provenance-record type, the prohibited-claim vocabulary, the settings definitions, and a complete
   deterministic stub. `TranslationPort` returns a typed `Dispatch` like every other port, takes
   segments in and returns segments out, and carries the engine identity and pinned snapshot in the
   result rather than on a connection. Two adapters: the Workers AI one, and a thin one over the shipped
   `InferencePort` for the frontier route. The stub reaches nothing, is deterministic, and is what every
   composition root resolves to when the binding or the enabling configuration is absent — the shipped
   `resolveScanPort` / `resolveEnginePort` shape.
2. **The segment model.** Nothing in the repo has an alignment unit, and a side-by-side view is
   meaningless without one. Recommended unit: **page index plus paragraph ordinal within the page**,
   because the composite extractor already produces pages, page is already the chunk boundary the search
   subsystem uses, and the per-page `native`/`ocr` provenance then attaches to segments for free. A
   segment is `{ pageIndex, ordinal, sourceText, targetText, provenance, engineSnapshotId }`. Pasted
   text is one synthetic page whose paragraphs are its blank-line-separated blocks.
3. **The provenance record** — its schema, its renderer, its prohibited-claim fitness function, and its
   verbatim negative statement.
4. **Per-firm schema:** `translation_run` (one row per run: engine, snapshot, languages, matter, member,
   counts, timings, the source hash), `translation_provenance` (the rendered record's stored fields,
   immutable once written), and `translation_member_acknowledgement`. **The segments themselves do not
   go in D1** — golden rule 3 puts bulk content in R2, and a 400-page contract is thousands of segments.
   The aligned segment set is one JSON object in R2 under the translation prefix, and the run row holds
   its key.
5. **Two object-class members** in `packages/object-dimensions`: `translation-artifact` on the
   matter-scoped union (a translation produced in a matter's context) and `translation-tool-artifact` on
   the firm-scoped union (a matter-free run from the Tools surface). The union is enumerated by a source
   scan against the write paths, so adding a member is a deliberate and tested act rather than a string
   appearing somewhere.

---

## 5. The feature shape

### 5.1 Pasted text — recorded, not ephemeral

The tempting answer is that a paste box leaves no trace. **Recommended: every run is recorded**, and
the argument is worth making because the intuition runs the other way.

A firm has to be able to answer "what did we send to which engine, about which client, and when". A run
that was discarded cannot be part of that answer, and a retention story with a hole in it labelled _the
paste box_ is not a retention story. The platform has already decided the analogous question once, in
the Magnus design's treatment of transcripts: what a member typed into an AI feature about a client's
affairs is a firm record. The paste box is not a privacy feature; treating it as one is how privileged
text ends up in a place nobody is accounting for.

So: a paste run creates a `translation_run` row exactly as a document run does, with `matter_id`
populated when the member names a matter and null when they do not. The source and target text go to R2
under the firm's own prefix, stamped with the dimensions like everything else. What differs between a
paste run and a document run is only that a paste run does not create a file record and does not appear
in the matter's file tree unless the member chooses to save it there.

### 5.2 Document translation — the path

```
existing file version, or a fresh upload
  -> the shipped untrusted-upload pipeline (scan verdict, file-type verification)   [existing]
  -> composite extraction: native text layer per page, OCR for the scanned pages    [existing]
     (a DOC/RTF/WordPerfect source converts to a supported form first, through the
      conversion registry and LibreOffice)                                          [existing]
  -> segmentation into { pageIndex, ordinal } units                                 [new, small]
  -> TranslationPort, batched, engine chosen by the firm's gates                    [new adapter]
  -> the aligned segment set, one R2 object                                         [new]
  -> renditions, on demand:                                                         [assembly + conversion]
       side-by-side DOCX  (two-column table, page markers, provenance appendix)
       side-by-side PDF   (the DOCX through LibreOffice)
       target-only DOCX / PDF
  -> optionally filed as a derived sibling document in the matter                   [existing file-manager]
```

Everything heavy is off the request path: the whole run is a queue message and a `TranslationJob`
Durable Object, polled exactly like a conversion job, per ADR-0039 and the shipped pattern.

### 5.3 The renditions, and why three rather than one

- **Side-by-side DOCX** — the working artifact. Source and target in adjacent columns, one row per
  segment, page-break markers as heading rows, the provenance record as a closing appendix, and the
  machine-output header on page one. This is the document a reviewer edits.
- **Side-by-side PDF** — the printable. The same DOCX through the shipped conversion edge. Nothing else.
- **Target-only DOCX / PDF** — because the side-by-side is a _review_ artifact and the thing that
  actually gets attached to a letter or handed to a client is the translation on its own. A firm forced
  to hand over a two-column review document because the product only makes one shape will paste the
  right column into Word, and then the provenance record is detached from the text it describes.

Every generated rendition carries the machine-output statement of section 2.5. Owner flag T8 asks
whether that statement is a visible header on the page or only in the appendix; the recommendation is a
visible header, removable only by the human-certification path.

### 5.4 Where a translated document lives — a derived sibling, not a new version

**Recommended: a new file record in the same folder, linked to the source file version by a typed
derivation link.** Not a version of the source document. The argument, because this is the shape
decision most likely to be made the other way by default:

A version chain means _successive states of the same document_. A Spanish original and its English
rendering are not successive states of one document; they are two documents, in two languages, both of
which stay current. Folding them into one chain breaks every reader that assumes the head version is
the authoritative current content — a member who downloads "the latest version" of a Spanish contract
would get English, silently. It breaks production and Bates numbering, where the original and the
translation are separate produced items carrying separate numbers. It breaks the file-hash integrity
story, where a version's hash is supposed to identify one document's bytes. And it makes "show me the
original" a request the version chain answers wrongly, since the original is now a superseded version.

The derivation link is what keeps them associated: a row recording that file B's version 1 was produced
from file A's version 3, by which run, in which direction. That makes "show me the translation of this"
and "show me what this was translated from" both answerable, without either document pretending to be
the other.

### 5.5 Matter scope, the wall, and retention

Translations are matter records and must be subject to the same boundaries as the documents they come
from. Here is how that is actually achieved today, stated honestly rather than asserted:

- **Scope.** The translation artifact is stamped with the **same `matter` dimension** as its source, at
  put time, server-derived, through the shipped `object-dimensions` mechanism. It is not re-derived and
  it is not taken from a request body. A translation therefore cannot end up scoped to a different
  matter than the document it came from without the stamp being wrong, which the write-path source scan
  is there to prevent.
- **Access.** Read access to a translation resolves through the **same matter entitlement as its
  source**, through the firm-scoped data-access layer and the one route chokepoint. There is
  deliberately no separate "read translations" permission, because a second, independently grantable
  permission over derived copies of matter documents is a way to make a copy readable by someone who
  cannot read the original.
- **Ethical walls.** Stating the true position: **ethical walls are not built anywhere in the platform
  yet** — the AI Search design says so explicitly and this design does not pretend otherwise. What this
  design does is make translations wall-ready by construction rather than by later retrofit: they carry
  the same dimensions as their source, and `confidentiality_scope` is **already reserved** in
  `object-dimensions` for exactly this purpose. When walls are built, translations are inside them
  because they were stamped the same way from day one, not because a sweep went back and found them.
- **Retention and destruction.** A translation filed as a derived sibling is an ordinary matter file and
  is swept by the matter's retention and the custodian destruction path with no special handling — which
  is the second reason for the derived-sibling shape in section 5.4. A matter-free tool run is
  firm-scoped, carries no matter, and needs its own retention answer; recommended default is a bounded
  lifecycle on the `translations/` prefix mirroring the shipped `conversions/` prefix, with the run row
  and the provenance record outliving the content.
- **The natural-language index.** A **filed** target-language document is an ordinary committed working
  document and is fed like any other. The **job artifacts** under the translation prefix — the aligned
  segment set, the intermediate renditions — are a different object class and are never fed. The feed
  writer is an allow-list of object classes, so this is enforced by the class not being on the list
  rather than by a rule remembering to exclude it. Owner flag T7.

---

## 6. The provenance record, concretely

A stored, immutable structured record plus a rendered document. The stored fields are the list in
section 2.5. The rendered document is produced by the same assembly engine as the side-by-side, from a
platform-owned template, and:

- is titled **Translation Provenance Record**, never anything containing the prohibited vocabulary;
- opens with the verbatim negative statement, above any process detail, in body text rather than a
  footnote;
- presents the process facts as a plain labelled table, with no seal, no border device, no signature
  line, and no space that invites one;
- prints the per-page extraction route as a table, so `pages 1-14 native, pages 15-22 ocr` is visible
  rather than summarized away;
- ends without a signature block.

It is generated on demand from the stored record, never edited. If a fact was not captured, the record
says **not recorded** rather than omitting the row, because an omitted row is indistinguishable from a
fact that did not apply.

**The certification escalation, if T3 is answered yes.** A second, separate artifact, produced only by
a human act: a member holding a distinct permission opens the aligned segments, reviews and edits them,
and then signs a certificate of accuracy in which **they** declare their competence in the language
pair and the completeness and accuracy of the translation. The platform supplies the form and records
who signed it and when; it never asserts that the signer is competent, because it has no way to know
and the declaration is the signer's to make. The signed certificate references the provenance record
rather than replacing it — the two answer different questions, and a reviewer is entitled to know that
the human draft started from an engine and which one. The sealing and signature machinery for this
already exists in `packages/signing` and the seal engine in `packages/pdf`.

---

## 7. Slices

### Slice 1 — pasted text, on-Cloudflare engine, provenance record (recommended first)

Small, self-contained, and useful on the day it ships: a member pastes a foreign-language letter, gets
an English rendering side by side in the browser, and gets a record of how it was produced.

- `@magna-carta/translation`: `TranslationPort`, the segment model, the provenance-record type, the
  prohibited-claim vocabulary and its fitness function, the two settings definitions, the disclosure
  version constant, and the deterministic stub.
- The Workers AI adapter for `@cf/meta/m2m100-1.2b`, resolved through a composition root that falls back
  to the stub when the binding or the gate is absent.
- `translation.enabled` (default false) and `translation.frontierEngineEnabled` (declared, default
  false, **not read** in slice 1); the `translation:translate` permission; the versioned member
  acknowledgement and its table.
- `translation_run` and `translation_provenance` in the per-firm schema; the aligned segment set and the
  source/target text to R2 under `translations/{runId}/`, stamped with the object-class dimension.
- One route pair on the shipped shape: synchronous below a character ceiling, queued through a
  `TranslationJob` Durable Object above it, with the shipped poll and events endpoints.
- One Tools manifest entry in the `files` subject group, `matterContext: "optional"`, and one page: a
  paste box, a language pair, a two-pane aligned result, and the provenance record on screen and
  downloadable as JSON.
- Load-profile fixtures for the run path; user documentation for the tool and for the firm-administrator
  enablement screen.

**Explicitly not in slice 1:** document upload of any kind; OCR; format conversion; generated DOCX or
PDF of any kind, including the printable and the side-by-side document (the side-by-side in slice 1 is
an on-screen view only); the frontier engine; filing a translation into a matter as a derived sibling;
human-attested certification; batch or bulk translation; translation memory, glossaries, or term bases;
language auto-detection beyond whatever the engine returns; desktop-specific work; and any claim
anywhere about accuracy, certification, or fitness for filing.

### Slice 2 — document translation and the generated artifacts

File-version or upload input through the shipped pipeline; composite extraction with the per-page
`native`/`ocr` provenance **persisted** for the first time; segmentation; the side-by-side DOCX from the
assembly engine and its PDF through LibreOffice; the target-only renditions; the provenance appendix and
the machine-output header; the derived-sibling file record and the derivation link; the
`translation-artifact` object class.

### Slice 3 — the frontier route

`translation.frontierEngineEnabled` becomes readable; the adapter over the shipped `InferencePort`;
per-segment engine and snapshot recording; the disclosure version increments and every member
re-acknowledges; the Magnus-equivalent firm disclosure content including the ADR-0110 residual sentence;
token metering through the shipped meter.

### Slice 4 — human-attested certification (owner-gated on T3)

The review surface over aligned segments, the edit path, the distinct permission, the signed certificate
of accuracy with a named signer, and the sealing path. Nothing here is built before slices 1-3 are
shipped, because a certification flow over an artifact family that does not exist yet is a flow designed
against guesses.

---

## 8. Owner flags

**T1 — Engine and consent posture.** _Recommendation:_ Workers AI `@cf/meta/m2m100-1.2b` as the default
engine behind `translation.enabled` alone; the frontier route behind all three gates; third-party
translation APIs (DeepL, Google, Azure) **refused for now**, with a firm that specifically requires one
routed to the already-named BYOK deferred seam. The reasoning is section 3.2.

**T2 — Is the provenance artifact offered at all?** _Recommendation:_ **yes**, in the constrained form
of sections 2.5 and 6. Refusing to build it does not remove the risk; it moves it into a Word document
somebody writes with no constraints, no fitness function, and no negative statement. Building it under
a name that cannot be mistaken for a certificate, with the prohibited vocabulary enforced in CI, is the
safer of the two available outcomes.

**T3 — Is human-attested certification in scope?** _Recommendation:_ **yes, but as slice 4 and not
before.** It is the feature that makes the rest of this legally useful — it is the difference between a
reading aid and something a firm can file — and it is also the feature with the most ways to go wrong.
It should be built once the artifact family it certifies is real. If the answer is no, sections 2.5 and
6 still stand unchanged and the product ships as an explicitly non-certifying reading aid.

**T4 — Pasted text: recorded or ephemeral?** _Recommendation:_ **recorded** (section 5.1).

**T5 — Translated document: derived sibling or new version of the source?** _Recommendation:_ **derived
sibling** (section 5.4).

**T6 — Which roles hold `translation:translate`, and is the member acknowledgement required for the
on-Cloudflare route too?** _Recommendation:_ acknowledgement required for **both** routes — the
"this is not a certified translation" sentence is engine-independent and is the one the member most
needs. Role assignment is the owner's.

**T7 — Are translations fed to the natural-language index?** _Recommendation:_ the **filed
target-language document yes** (it is an ordinary committed working document); the **job artifacts
never** (a separate object class, absent from the feed's allow-list by construction).

**T8 — Does the machine-output statement appear as a visible header on every generated rendition, or
only in the provenance appendix?** _Recommendation:_ **a visible header on every generated rendition**,
removable only by the slice-4 certification path. A statement in an appendix is a statement on the page
that gets detached first.

---

## Appendix A — What this design does not touch

The discovery subsystem, the trust and billing ledgers, the conflicts engine, the calendar, the client
portal, Magnus's conversation model, the AI Search index and its feed writer (this design proposes what
should and should not be fed, and edits nothing), `packages/inference` itself (used as shipped), the
OCR and LibreOffice containers (used as shipped), and the rendered trackers — `CHANGELOG.md`,
`STATUS.md`, `ROADMAP.md`, and the Decision-Log register — which are assembled from fragments on `main`.

## Appendix B — Rejected alternatives

- **Composing the side-by-side PDF directly with `packages/pdf`.** No text-layout engine there; would
  duplicate a pipeline that already ends in PDF, and would produce an uneditable artifact the human
  review path cannot use.
- **Storing segments in D1.** Bulk content; golden rule 3.
- **A translation as a new version of the source file.** Section 5.4.
- **A separate "read translations" permission.** A second grantable permission over derived copies of
  matter documents is a way to widen access to a document's content without widening access to the
  document.
- **Adopting DeepL or Azure Translator now.** Section 3.2; a fourth processor in the privilege chain for
  quality the frontier route already provides.
- **Calling the artifact an audit report.** "Audit" already names the platform's access and event
  auditing; and the word makes the artifact sound like a verdict on the translation rather than a record
  of the process.
- **A quality or confidence score on the output.** Any number next to a translation is read as an
  accuracy measure. There is no honest one to give.
