# Translation Services

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

<!-- public-group: Translation -->

- id: translation
  name: Translation services
  scope: Machine translation of pasted text and of matter documents, aligned side-by-side and target-only renditions, and a provenance record of how each translation was produced.
  status: designed
  adrs: ADR-0109, ADR-0110, ADR-0111
  spec: docs/specs/2026-08-10-translation-services-design.md
  evidence: Merged design with four slices and no implementation plan; no translation package, no port, no per-firm table, no route and no screen. Every seam it rides — per-page native/OCR extraction, the conversion registry, the asynchronous job shape, OOXML assembly and the inference chokepoint — is shipped and belongs to other nodes.
  audience: public
  public-name: Translation
  public-summary: Translate a pasted passage or a whole document, read the original and the translation side by side, and keep a record of exactly how the translation was produced.
  notes: Spoken interpretation is a person and not a feature; translation memory, glossaries and term bases, product localization, and any automated judgement of translation quality are all outside this capability.

- id: translation.pasted-text
  name: Pasted-text translation
  scope: A member pastes a passage, names a language pair, and reads the result aligned beside the original on the matter-free tool surface.
  status: designed
  spec: docs/specs/2026-08-10-translation-services-design.md
  evidence: Specified as the first slice, buildable on the recommended defaults and depending on nothing unbuilt; no tool manifest entry, no route and no page exists.
  awaiting-owner: Whether a pasted run is recorded or ephemeral. Recommended recorded: a firm has to be able to answer what it sent to which engine, about which client and when, and a retention story with a hole in it labelled the paste box is not one — the platform already answered the same question the same way for what a member types into its assistant. Ephemeral is the intuitive answer and it means privileged text passes through a place nothing accounts for. Recording it costs a run row and an object per paste. Translation design flag T4.

- id: translation.documents
  name: Document translation
  scope: Translating an uploaded or already-filed document end to end — conversion where needed, per-page native or recognized text extraction, segmentation into aligned units, and where the translation lands in the matter.
  status: designed
  spec: docs/specs/2026-08-10-translation-services-design.md
  evidence: Specified as the second slice over the shipped composite extractor, the conversion registry and the LibreOffice edge; the segment model and the derivation link are the only new pieces and neither exists. This is the first consumer with a reason to persist the per-page native/recognized distinction the extractor already computes and currently discards.
  awaiting-owner: Whether a translated document is a new file beside its source or a new version of it. Recommended a derived sibling linked to the source version: a version chain means successive states of one document, and a Spanish original and its English rendering are two documents that both stay current, so folding them into one chain means a member downloading the latest version of a Spanish contract silently gets English. Choosing the version chain instead removes the link table and breaks the "show me the original" read. Translation design flag T5.

- id: translation.renditions
  name: Side-by-side and target-only renditions
  scope: The generated artifacts — an editable side-by-side document with the source and target in adjacent columns, its printable, and the translation on its own for handing to a client.
  status: designed
  spec: docs/specs/2026-08-10-translation-services-design.md
  evidence: Specified as an assembly over the shipped OOXML package reader and writer, converted through the shipped document-to-PDF edge rather than composed directly, because the PDF package has no text-layout engine and the review path needs an editable draft. No template and no renderer exists.
  awaiting-owner: Whether the statement that this is machine output appears as a visible header on every generated rendition, or only in the closing provenance appendix. Recommended the header, removable only by a human certification path if one is ever built: an appendix is the part that gets detached first, and the artifact that survives detachment is a fluent translation with nothing on it saying no person has read it. The appendix-only answer produces a cleaner document a firm can hand over, and a cleaner document is exactly the one that gets mistaken for a certified one. Translation design flag T8.

- id: translation.provenance-record
  name: Translation provenance record
  scope: A stored, immutable record of how one translation was produced — source bytes and their hash, the extraction route per page, any conversion, the engine and its pinned snapshot, the languages, who ran it and when, and whether any human edited the output.
  status: designed
  spec: docs/specs/2026-08-10-translation-services-design.md
  evidence: The design fixes what the record may state, what it may never state, and the statement it must carry verbatim, plus a fitness function over the renderer's own strings to keep it that way; no record type, no renderer and no vocabulary module exists.
  awaiting-owner: Whether this artifact is offered at all. It is one word away from a certificate of translation accuracy, which is a named person's signed attestation that no machine can hold either half of — and a document reciting an engine and a date under a heading like that will be filed by somebody as though it were one. Recommended yes, in the constrained form: refusing to build it does not remove the risk, it moves it into a document somebody writes in a word processor with no constrained vocabulary, no fitness function and no statement of what it is not. Translation design flag T2.
  notes: It is never called an audit report — audit already names this platform's access and event auditing — and it carries no signature block, no seal, no ruled line and no confidence score, because a document that invites a signature is a certificate with the signature not yet applied.

- id: translation.engines
  name: Translation engines and consent gates
  scope: Which engine may see a privileged document under which consent — the on-platform engine behind the feature gate alone, and a frontier model through the shipped inference chokepoint behind all three gates.
  status: designed
  adrs: ADR-0109, ADR-0110, ADR-0111
  spec: docs/specs/2026-08-10-translation-services-design.md
  evidence: The port, the two adapters, the deterministic stub and the two firm settings are specified against the shipped gateway chokepoint and the shipped feature-specific consent pattern; none of them is written, and no translation setting is declared.
  awaiting-owner: Which engine is the default and whether third-party translation vendors are adopted. Recommended: the on-platform model as the default, behind the feature gate alone rather than the third-party-processing gate, because it sends content to no third party and requiring that gate would deny the on-platform route to exactly the most conservative firms; the frontier route behind all three gates; and the dedicated translation vendors refused for now, since they buy quality the frontier route already delivers while adding a fourth data processor to the privilege chain and a credential lifecycle nobody has built. A yes to a vendor means building the credentialed adapter that is currently a deferred seam. Translation design flag T1.
  notes: The engine actually used is recorded per run rather than as a policy statement, so a firm asked later what saw a client's document has an answer for each translation.

- id: translation.certification
  name: Human-attested certification
  scope: A named person reviews the aligned translation, edits it, and signs a certificate of accuracy declaring their own competence in the language pair and the completeness of the rendering.
  status: deferred
  spec: docs/specs/2026-08-10-translation-services-design.md
  evidence: Parked by the translation design to its fourth slice and gated on an open owner flag; nothing is built. The sealing and signature machinery it would reuse is shipped in packages/signing.
  awaiting-owner: Whether the platform offers human-attested certification at all. It is the difference between a reading aid and something a firm can file — under the governing federal standard a competent person may run an engine, review the output line by line and then sign, at which point the certificate is true — and it is also the part with the most ways to go wrong, so the recommendation is yes but only once the artifacts it would certify exist. A no means the product ships permanently as an explicitly non-certifying reading aid, which changes nothing else in this area. Translation design flag T3.
  notes: The platform supplies the form and records who signed it and when; it never asserts that a signer is competent, because it has no way to know and that declaration is the signer's to make.
