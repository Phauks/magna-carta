---
category: Added
---

The design for **translation services** — pasting in foreign-language text or handing over a document and
getting an English rendering back, side by side with the original, with a record of exactly how it was
produced. Design only; no product code, and nothing is enabled for any firm.

**It translates. It does not certify, and it is built so that it cannot pretend to.** A certified
translation is a person's signed statement that they know both languages and that this particular
translation is complete and accurate. That is an act by a human being, and no machine can perform it — the
federal immigration regulation and the way courts admit translated exhibits both come to the same place
from opposite directions, and Nevada state practice has no local rule filling the gap, which means the
practitioner needs a person to sign either way. So the product draws the line in the artifact itself. What
it produces is a **Translation Provenance Record**: which engine ran, which model and which pinned version
of it, on what date, at whose request, on which matter, against a document whose exact bytes are
fingerprinted, and — page by page — whether the text came from the document's own text layer or from a
machine reading a picture of the page. Every one of those is a fact about the process. None of them is a
claim about whether the translation is right. The record opens by saying, in as many words, that it is not
a certificate and that nobody has attested to anything, it carries no seal and no signature line, and a
list of forbidden words is checked against the template by an automated test so that the day somebody
edits it to say "certified" the build refuses.

**The engine choice is the firm's, and the strictest option is the default.** The everyday engine runs on
the same infrastructure the rest of the product already runs on: no outside model company sees anything,
and the provider's published position is that inference content is discarded rather than kept and is never
trained on. It is honestly described as what it is — good for reading an incoming letter, not good enough
to be the draft a professional signs — because a firm discovering that for itself, on a client's contract,
is the wrong way to learn it. A firm that wants the substantially better frontier model can have it, but
that route sends content to an outside provider, so it sits behind three separate switches that all
default to off, and the firm is told what leaves and where it goes in the same words the assistant feature
already uses. Three commercial translation services were looked at and turned down for now: their handling
terms are mostly good, but each one adds another company into the chain of people holding privileged
material, for quality the frontier route already provides.

**Every person who uses it is told the one sentence that matters**, whichever engine is in effect and
before their first run: this is machine output, it can be wrong in ways that read perfectly fluently, and
it may not be filed anywhere a certified translation is required.

**Almost none of it is new machinery.** Deciding whether a PDF is real text or a scan, and running
recognition on only the scanned pages, is something the platform already does per page for search — and
the translation record is finally a reader for a distinction that pipeline has been computing and throwing
away. Converting an odd old format into something usable, and turning the finished document back into a
PDF, is the existing conversion path. The two-column side-by-side document is the existing document
assembly engine filling a table, which has the useful side effect of leaving the result editable, so a
reviewer can correct it. Long jobs run on the same queue-and-progress machinery as every other long job.

**A translation is a sibling of the original, not a new version of it.** They are two documents, both
current, in two languages — and quietly replacing "the latest version" of a Spanish contract with an
English one is the kind of surprise that ends up in front of a client. They are linked instead, so each
can be found from the other, and the translation carries exactly the same matter and confidentiality
markings as the document it came from, so whatever access boundaries get built later apply to both without
anyone having to go back and find them.

Also settled: the first slice is deliberately tiny — pasted text, the on-platform engine, an on-screen
side-by-side and the provenance record, and not a single generated file; document upload, the printable
side-by-side, and the frontier engine come after; and a properly human-signed certificate of accuracy, by
a named member who has actually read the thing, is held as its own later piece of work, because that is
the feature that turns this from a reading aid into something a firm can file, and it deserves to be built
against a real artifact rather than a guess.
