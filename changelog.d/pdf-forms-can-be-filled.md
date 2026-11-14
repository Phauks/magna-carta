---
category: Added
audience: public
---

**The PDF Editor's Forms tab.** The worker reads the form's fields with `readForm` and writes the reader's answers with `fillForm`, optionally flattening them (`flattenForm` when only flattening). Only answers that differ from what the document holds are written, and read-only fields, push buttons and signature fields are never written (`apps/web/src/lib/pdf-editor/forms.ts`). The filled form is saved as a new version of the same file. Tested against the real engine (`apps/web/test/pdf-editor-forms.test.ts`).

## Public

**Fill in PDF forms.** In the PDF Editor's Forms tab, answer a form's fields beside a preview of the page, see which required fields are still empty, and save the answers as a new version, optionally flattened so they cannot be changed.
