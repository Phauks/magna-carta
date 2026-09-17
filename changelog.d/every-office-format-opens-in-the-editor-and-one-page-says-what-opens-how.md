---
category: Added
audience: public
---

**Spreadsheets, presentations and drawings open in the browser editor, and one register says how every kind of file opens.**

Only word-processing documents opened in the editor. The editor is Collabora Online, and the formats it opens are the ones its own discovery document lists for Writer, Calc, Impress and Draw; those lists are now the platform's, so a spreadsheet, a presentation or a drawing opens the way a document does, older formats included (WordPerfect, Lotus 1-2-3, Keynote, Pages, Numbers, Visio). A legacy format the ingest gate has no signature for is known by its extension, which is what the editor decides by too.

Which formats take which way is one register (`apps/web/src/lib/documents/file-type-register.ts`): the file manager decides the one Open gesture from it, and **Settings › Documents › Opening Files** renders it, so what a member reads there is what the product does. The page is a routing table with nothing to change yet — every family opens one way — built so that when a family gains a second way of opening, the choice is made there. Guide: `docs/user/admin/opening-files.md`.

## Public

Spreadsheets and presentations open in the browser editor. A new settings page, Opening Files, lists what every kind of file does when you open it.
