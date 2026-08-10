---
slug: translation-services-provenance-not-certification
status: Proposed
area: Documents
date: 2026-08-10
summary: "Translation services are adopted as a document-and-text capability that generates translations and describes how it generated them, and never certifies them. A certificate of translation accuracy is a named human being's signed declaration of competence in the language pair and of the completeness and accuracy of the specific translation (8 CFR 103.2(b)(3); 8 CFR 1003.33; the authentication practice behind Fed. R. Evid. 604 for documentary exhibits; NRS 50.054 and NRS 1.510 for Nevada interpreters, the Eighth Judicial District Court Rules containing no express rule on translated exhibits), and no engine can hold either half of it. The platform therefore emits a Translation Provenance Record — engine, model, pinned snapshot, date, operator, matter, source hash, per-page native/OCR extraction route, conversion engine, segment counts, and whether any human edited the output — carrying a verbatim statement that it is not a certification, with a prohibited-claim vocabulary (certificate, certified, sworn, accurate, complete, court-ready, USCIS-accepted, any quality score, any signature line or seal) enforced by a fitness function over the renderer's own strings. Engine posture: Cloudflare Workers AI m2m100-1.2b is the default behind its own fail-closed firm gate and does NOT require the third-party frontier consent axis; the frontier route through the shipped inference chokepoint requires all three gates; DeepL, Google Cloud Translation, and Azure Translator are refused for now in favour of the already-named BYOK deferred seam. A member acknowledgement is required for both routes, because the sentence the member needs is engine-independent. Translations are derived sibling documents, never new versions of the source, stamped with the source's own matter and object-class dimensions."
---

**Build translation services as a generate-and-describe capability, never a certify capability: a
Translation Provenance Record that states how the output was produced and is structurally incapable of
claiming what it is worth, with human-attested certification held as a separate, later, human-signed
artifact.**

**Context:** The owner asked for pasted-text and document translation, OCR and conversion where a source
needs it, side-by-side output, printables, and "an audit report for translation that shows technology and
date used". That last item sits one word away from a certificate of translation accuracy, and the two are
categorically different things. Under 8 CFR 103.2(b)(3) a foreign-language document submitted to USCIS
must be accompanied by a full English translation the translator has certified as complete and accurate,
plus the translator's certification that they are competent to translate from that language into English;
8 CFR 1003.33 imposes the equivalent in immigration court and the EOIR Policy Manual publishes the form.
Nothing in the regulation prohibits machine-assisted drafting, and nothing in it can be satisfied without
a person: certification is an act by a human, not a status conferred on a document. Federal courts reach
the same place from the evidence side — Fed. R. Evid. 604 treats an interpreter as an expert who must be
qualified and sworn, and a translated exhibit is admitted on a declarant who describes their
qualifications and vouches for the rendering, with untranslated material routinely disregarded on summary
judgment and unusable on appeal. In Nevada, NRS 50.054 and NRS 1.510 / 1.520 govern interpreters rather
than documents, and the Eighth Judicial District Court Rules contain no express rule on foreign-language
documentary exhibits at all — so the Nevada practitioner has no local checklist and still needs a human
declarant. "Sworn translation" is a civil-law status that does not exist in United States practice and
must never appear in product language.

**Decision:** Adopt translation services, designed at
docs/specs/2026-08-10-translation-services-design.md. The provenance artifact is built, because refusing
to build it only relocates the risk into an unconstrained document somebody writes in Word, but it is
named a Translation Provenance Record, states only observed process facts (engine, provider, model and
pinned snapshot, where it ran, source and target language, source file name and SHA-256 and page count,
per-page `native`/`ocr` extraction route with the recognition engine version, any pre-extraction
conversion engine, segment counts, UTC timestamp, firm, operator, matter, the platform build, and whether
any human edited the output — stated affirmatively when none did), opens with a verbatim statement that it
is not a certificate of translation accuracy and that no person has attested to the translation, and
carries no signature block, seal, ruled signature line, quality score, or confidence figure. A
prohibited-claim vocabulary lives beside the renderer and a fitness function scans the renderer's strings
and templates against it, in the same spirit as the shipped source-scan fitness functions. Engine posture:
Cloudflare Workers AI `@cf/meta/m2m100-1.2b` — the only model in the Workers AI translation task category
— is the default engine behind a new fail-closed `translation.enabled` firm gate and deliberately does not
additionally require `inference.aiProcessingEligibility`, since no third-party frontier model is involved,
on the same reasoning AI Search used; the frontier route through the shipped `@magna-carta/inference`
chokepoint sits behind a third gate, `translation.frontierEngineEnabled`, and requires all three to be
open; DeepL, Google Cloud Translation, and Azure Translator are refused for now, because each adds a
fourth processor to the privilege chain and a credential lifecycle for quality the frontier route already
delivers, and a firm that specifically requires one is the already-named BYOK deferred seam. A versioned
member acknowledgement is required for both routes, not only the frontier one, because the sentence the
member must read — this is machine output and is not a certified translation — is engine-independent.
Translated documents are derived siblings linked to the source file version, never new versions of it, and
carry the source's own server-derived `matter` and `object_class` dimensions. Human-attested certification
by a named member is in scope only as a later slice and only as a separate artifact with a real signer.

**Consequence:** Almost nothing new is built. The composite per-page `native`/`ocr` extractor in
`apps/worker/src/search/text-extraction.ts` becomes the input to the provenance record — the first
consumer with a reason to persist a distinction the extractor already computes and currently discards.
Format conversion and OCR ride the shipped conversion registry, the LibreOffice container, and the OCR
container unchanged; the job path is the shipped queue plus per-job Durable Object shape; the side-by-side
document is a two-column OOXML table produced by `packages/document-assembly` and rendered to PDF through
the shipped DOCX-to-PDF edge, so no new renderer exists and the review draft stays editable. Genuinely new
are a `@magna-carta/translation` package with `TranslationPort`, a page-plus-paragraph segment model, the
provenance record and its fitness function, two firm settings, one permission, three per-firm tables, and
two members added to the object-class unions. Segments are bulk content and live in R2, never D1. Slice 1
is pasted text on the on-Cloudflare engine with the provenance record and no generated document at all;
document translation, the generated side-by-side and printables, the frontier engine, and human
certification are slices 2 through 4. Ethical walls remain unbuilt platform-wide; translations are made
wall-ready by carrying their source's dimensions and by the already-reserved `confidentiality_scope`
dimension, rather than by a later retrofit. Eight owner flags carry recommended defaults the design
already implements.
