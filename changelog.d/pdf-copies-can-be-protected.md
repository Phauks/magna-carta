---
category: Added
audience: public
---

**The PDF Editor's Secure tab.** The worker counts what the file carries (hidden or covered text, comments, metadata, hidden layers, filled form fields) with `detectDocument`, `readForm` and `inspectSecurity`, and only the counts leave it, never the recovered text (`apps/web/src/lib/pdf-editor/secure.ts`). A protected copy is made with `secureDocument` (AES-256 by default, AES-128 on request), an optional open password, a permissions password made in the browser when the reader leaves it empty and shown once, and the four recipient permissions; `sanitizeDocument` runs first unless the reader opts out. Passwords are never stored, sent or logged. Tested against the real engine (`apps/web/test/pdf-editor-secure.test.ts`).

## Public

**Password-protect a PDF.** In the PDF Editor's Secure tab, see what a file carries besides its pages, then save a protected copy with a password to open it, a choice of what recipients may do (print, copy, edit, comment), and its hidden data removed first. Magna Carta never keeps the passwords.
