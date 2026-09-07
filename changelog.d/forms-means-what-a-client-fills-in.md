---
category: Changed
audience: internal
---

**Forms** now means what a client or a prospect fills in, not the firm's document automation.

The word was doing two opposite jobs on shipped screens: the sidebar destination described itself as "Document automation and court forms", while the intake procedure's step vocabulary called a client's questionnaire the client's online forms. A member who learned one meaning was wrong on the other screen.

Three things already in the code decided which meaning went. A fillable court PDF and a `.docx` template are two kinds of ONE record — `document_template_version.kind` — sharing the catalogue, the version ladder, the ingest gate, the manifest shape, the dictionary and the provenance row, so "forms versus templates" is not a boundary the data has. The permission registry had already drawn the boundary that is real and it is a different one: `templates:manage` is firm-rooted and administrative, `documents:assemble` is matter-rooted, and nothing is called `forms:*`. And the act the destination existed to host already had a home — assembling a document is live on the matter's Add a Document dialog.

So templates belong to the documents cluster, the curated court-form library will land there as templates of a kind rather than a separate shelf, and Forms is reserved for the public intake form and the portal's client forms. Nothing is built behind it yet; it stays announced-not-shipped.

One gap surfaced while executing this. The field-input scaffold at `/forms/assemble` had been read as a duplicate of the live matter dialog, and it is not: the live path merges from matter data alone, and no supplied value is accepted by the request body, the engine, or the schema — a field the matter cannot answer becomes an absence in the finished document. Assembly from values a person supplies is unbuilt, is now carried in the feature ledger as `document-automation.supplied-values`, and the scaffold moved to `/developer-console/document-assembly` rather than being deleted, so the shape survives until the contract exists.
