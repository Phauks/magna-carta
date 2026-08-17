---
number: 285
slug: assembled-pdf-goes-through-the-existing-conversion-edge
status: Accepted
date: 2026-08-13
area: Document automation
summary: "An assembly asked for a PDF converts through the registry's own `docx` to `pdf` edge inside the same job, using `runConversion` and the same per-engine-id resolver the file-converter tool executes with — no engine of document automation's own, no new registry edge, and no second answer to what a firm's document looks like on paper. The requested format is a column on `document_assembly` rather than something inferred from the filed object, because a job that FAILED still has to say what it was trying to make. A conversion that cannot be done fails the assembly instead of filing the word-processing package, on the reasoning that a member who asked for a PDF and silently received a Word document does not find out until the seal refuses it. That same recorded format is the whole of the signature hand-off on the backend: the poll answers it beside the file and version handles, so a caller knows before the document lands whether it is in the one shape `POST /api/v1/documents/seal` accepts."
---

**A document assembled as a PDF is converted by the office suite, on the conversion edge that already exists, inside the assembly job.**

**Context:** The merge engine emits a word-processing package and nothing else — that is its whole
subject matter, and the reason the engine is pure TypeScript over OOXML rather than a renderer. But
the two things a firm most often does with an assembled document are sign it and send it, and both
want a PDF. The platform seal (`POST /api/v1/documents/seal`) takes a PDF and refuses anything else.

Three ways to produce one were available. Render the PDF in the merge engine, which would mean
document automation owning a page renderer and a second opinion about what a firm's letterhead looks
like on paper. Convert it afterwards through the file-converter tool, which produces a transient
artifact under the `conversions/` prefix that expires and is never filed — so the member would have to
download it and upload it back, and the document on the matter would be a second row nothing connects
to the assembly that made it. Or convert inside the job, on the edge the registry already declares.

**Decision:**

(1) **The registry's edge, executed by whatever service resolves it.** The PDF arm calls
`runConversion("docx", "pdf", mergedBytes, resolveEnginePort(env))` — the same function the conversion
queue consumer calls, the same `docx`-to-`pdf` row in `packages/conversion/src/registry.ts`, and the
same per-engine-id resolver, so the hop runs wherever that engine runs and follows it if it moves.
Document automation contributes no engine, no adapter, and no registry entry. The office suite is
already the one thing in the platform that renders a word-processing package faithfully, and a second
path to a PDF would be a second answer to a question a firm gets to ask only once per document.

(2) **Inside the same job, not a second job the caller chains.** The assembly job was asynchronous
from its first line partly in anticipation of this hop; it has the coordinator, the stuck alarm, the
poll, and the ingest chokepoint already. Making the caller submit a conversion afterwards would give
the produced document two provenance rows and no relationship between them, and would put an expiring
artifact between the merge and the filing.

(3) **The requested format is stored, not inferred.** `document_assembly.output_format` is an additive
column with a `docx` default. Reading the format off the filed object would answer only for a job that
succeeded, and the interesting cases are the other two: a job still queued (a caller deciding what it
may offer next) and a job that failed (a member asking what went wrong). Both need the answer, and
neither has an object to read it from.

(4) **A conversion that cannot be done fails the assembly.** Nothing is filed. The alternative — file
the word-processing package and report the conversion as a warning — produces a document that reads as
the one the member asked for, sits in the matter looking finished, and is discovered to be the wrong
thing at the moment somebody tries to sign it. That is the same class of failure the absence model
exists to prevent one level down, and it gets the same answer: a visible refusal beats a silent
substitution. The failure code is `conversion-failed` and it is terminal, so the message is acked
rather than retried — a deployment where the office suite is unreachable does not become a queue of
jobs burning their attempts.

(5) **The signature hand-off is the recorded format, and nothing more was built.** The plan's tail
described the hand-off as a link rather than a build, and that is what the platform can honestly
support today: the seal is a stateless operation over PDF bytes, and there is no envelope, signer
invitation, or consent-disclosure model on `main` for an out-for-signature workflow to hang from. So
the assembly result states what it produced, which is exactly what a caller needs to know whether the
document is in the seal's shape; a signing ceremony surface is named as deferred rather than invented,
because a consent disclosure is a legal artifact and guessing at one would be worse than not offering
the button.

**Consequences:** "Build this from a template as a PDF" is one request and one job, and the document
that lands is an ordinary matter document that cleared the same scan every other file does. The office
suite is reached through a deploy-time binding, so the arm is live in a deployed environment and
honestly reports itself unavailable elsewhere — recorded in the Documents surface's availability
inventory rather than left to look like a defect. Fillable-PDF form templates, the other half of the
tail, are not in this change and are planned separately; the same is true of the signing ceremony.
