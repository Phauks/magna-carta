---
category: Added
audience: public
---

**The File Workbench's Email tab is served, and email converts to PDF.** `apps/web/src/lib/tools/file-workbench/panels/email-panel.svelte` parses the message in the browser through `@magna-carta/email` and shows the header facts, the Received chain oldest first, authentication results, the text body and the attachments; an attachment can be added to the bench as its own file (a new optional `onAddFiles` on the capability panel props) or saved. `@magna-carta/email/message-document` lays a parsed message out as a `pdf-compose` document (header fields, body, attachment table, optional full-header page, page numbers), and the tab saves it. The web builds now build the email and pdf-compose WASM packages, and the Vite dev server is allowed to serve workspace package files so the WASM loads in development.

## Public

**Read a saved email and keep it as a PDF.** Drop an `.eml` or `.msg` file on the File Workbench and open the **Email** tab to see who sent it and to whom, when, whether the sending domain signed it, the mail servers it passed through in order, its text and its attachments. An attachment opens on the workbench as a file of its own, or saves to your computer. **Save as PDF** writes the message as a PDF with an attachment list, and **Include every header** adds a page with every header line. All of it happens in your browser; nothing is uploaded.
