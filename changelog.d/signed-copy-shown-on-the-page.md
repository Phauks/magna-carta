---
category: Changed
audience: public
---

**The signed copy and its certificate show on the page the completion email opens, and documents fit a phone's width.** `/sign/copy/<link>` now draws both PDFs on the page, with a tab to switch between them and a download for the one shown, through a new read-only `apps/web/src/lib/documents/pdf-page-stack.svelte` (the firm's own engine in a worker, never the browser's PDF viewer, fitted to the width it is given and never drawn past a page's own size). The signing page fits its pages, and the fields over them, to the reading column's width the same way, so a signer on a phone sees the whole width of each page without scrolling sideways. Each page is drawn once at its full size and only scaled on screen, so a resize costs no redraw.

## Public

The link signers get when a document is complete now shows the signed copy and its Certificate of Completion right on the page, as well as letting them download both. On a phone, documents to sign now fit the screen's width.
