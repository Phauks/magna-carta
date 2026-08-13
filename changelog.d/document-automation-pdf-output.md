---
category: Added
audience: public
---

**An assembly can be asked for a PDF, and the job says which of the two it is producing.** The submit
route takes an optional `outputFormat` (`docx` by default, `pdf`); the `pdf` arm hands the merged
package to the registry's own `docx` to `pdf` edge inside the same job, through `runConversion` and the
same per-engine-id resolver the file-converter tool executes with, and files what comes back under a
`.pdf` name with `application/pdf` declared to the ingest gate. There is no second conversion path, no
engine belonging to document automation, and no new registry edge — the office suite already had
exactly this job.

A conversion that cannot be done **fails the assembly** (`conversion-failed`) rather than filing the
word-processing package instead. That is the whole reason the requested format is a column on
`document_assembly` (`output_format`, additive migration
`20260813T000000_document-assembly-output-format`) rather than something inferred from the filed
object: a job that failed still has to say what it was trying to make, and a member who asked for a
PDF and silently received a Word document finds out when the seal will not take it.

The same column is the signature hand-off. `GET /api/v1/matters/{matterId}/assemblies/{assemblyId}`
now answers `outputFormat` beside the file and version handles, from the moment of submit and after a
failure, so a caller knows whether the produced document is in the one form `POST
/api/v1/documents/seal` accepts before it has landed. Nothing about the seal itself changed; the
assembled document simply arrives in its shape.

The office suite runs in a container the convert worker owns, which is a deploy-time activation — the
Documents surface's availability inventory records the PDF arm as `deployed-only` for that reason
rather than leaving a person to conclude the feature is broken.

## Public

**A document you build from a template can now be built as a PDF.** Choose "PDF — ready to sign" in
the Build-a-document dialog and the finished document is filed as a PDF rather than a Word document,
which is the form it has to be in before it can be signed. It takes a little longer, because the
document is converted before it is filed.

If the conversion cannot be done, the build fails and says so. You will not be handed a Word document
in place of the PDF you asked for.
