---
category: Added
audience: public
---

**The PDF Editor, with Redact.** `/documents/[id]/pdf` opens from the reader's new Edit PDF button. Redact marks boxes or whole pages, each with a reason, and applies them in a worker through `@magna-carta/pdf`'s `redactDocument` (`apps/web/src/lib/pdf-editor/pdf-operations.worker.ts`), so the engine verifies the output before anything is filed. The result is uploaded as a new file, `<name> (Redacted).pdf`, beside the original, with an optional CSV redaction log that records page and reason, never text. The screen-to-PDF coordinate conversion is pure and tested (`apps/web/test/pdf-editor-redactions.test.ts`).

## Public

**Redact a PDF on a matter.** Open a PDF, choose **Edit PDF**, and drag boxes over what should be withheld, or redact a whole page. Give each one a reason, then apply them all at once. Magna Carta removes what is under each box, checks that it is gone, and saves a redacted copy beside the original, which stays as it was. It can also save a redaction log listing each page and reason.
