# Content disarm (CDR) — design

**Status:** Accepted (design and engine) · **Date:** 2026-11-13 · **Owner:** Trevor Goldsmith
**White-paper home:** _Core domain_, untrusted file handling (stage 4, the disarmed rendition).
**Decision:** `docs/decisions/0526-content-disarm-is-in-house-rust.md` (until the register assembles it).
**Roadmap nodes:** `documents.scanning.cdr`, `matters.file-manager.untrusted-pipeline.cdr`.

## What it is for

A document from outside the firm (opposing counsel's production, a client's upload, an email
attachment) can carry something that acts when it is opened: a macro, PDF JavaScript, an action that
launches a program, an embedded executable, a field that runs a command, a template fetched from a
server that captures the reader's network credentials. Scanning catches what is already known.
Disarm removes the whole category, known or not, and leaves the document readable.

The original is evidence and is never touched. The disarmed copy is a separate file.

## Approach: neutralize in place

A pixel rebuild (render every page to a picture, rebuild a PDF from the pictures) is the safest
transform and the worst for a law firm: text, form fields, links and searchability are gone, and every
document runs through the office suite first. This engine instead removes the acting parts from the
document's own structure and keeps everything else, then re-reads its own output to prove the removal.

| Format                                                                                       | Removed or neutralized                                                                                                                                                                                                         | Kept                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PDF                                                                                          | JavaScript (actions and the document script table), open and additional actions, launch, submit, import, remote-file and embedded-file actions, non-web links, embedded files, XFA, rich media and 3D                          | Pages, text, pictures, ordinary form fields, bookmarks, web links                                                                                             |
| Word, Excel, PowerPoint (`.docx`, `.docm`, `.xlsx`, `.xlsm`, `.pptx`, `.pptm` and templates) | Macro project and its companions, ActiveX controls, custom ribbon, external workbook links, external relationships other than web hyperlinks (blanked), embedded objects (emptied), DDE and include fields, Excel DDE formulas | Content, formatting, pictures, charts (their embedded workbooks are disarmed in turn), web hyperlinks, each field's shown result, each formula's cached value |
| RTF                                                                                          | Embedded objects, object data, data stores, DDE and include fields                                                                                                                                                             | Text, formatting, each object's picture, each field's shown result                                                                                            |
| JPEG, PNG, GIF, TIFF, BMP, WebP                                                              | Everything but the pixels (decoded and encoded afresh): metadata, comments, colour profiles, trailing bytes. An animated GIF keeps its first frame and says so                                                                 | The picture                                                                                                                                                   |

Refused: legacy binary Office files (`.doc`, `.xls`, `.ppt`), password-protected files, anything
over a limit, anything malformed, and any format not listed. A refusal is a stable code, never a
partial copy.

A macro-enabled package comes out with its plain extension (`.docm` to `.docx`), so a file that can
no longer hold macros is not named as one that can.

## Shape

- `crates/disarm-core` — the engine. `disarm(bytes) -> Disarmed { bytes, kind, report, output_extension }`.
- `packages/disarm` — the same engine in WebAssembly for the browser and Workers.
- The report is counts by kind (`script`, `automaticAction`, `externalAction`, `embeddedFile`,
  `embeddedObject`, `control`, `dynamicForm`, `activeContent`, `externalLink`, `dynamicField`,
  `customInterface`, `pictureMetadata`, `animationFlattened`). It never repeats content.

## Limits

Input 256 MB; an Office package at most 20,000 entries, 512 MB per part, 1 GB inflated in total and
three levels of embedded packages; pictures at most 100 million pixels; RTF nesting at most 512.
A caller with a tighter memory budget passes smaller limits.

## What comes next (not in this change)

1. **The File Workbench's Disarm tab** — run in the browser on a dropped file, show what was removed,
   offer the copy. Needs a mockup the owner picks.
2. **A pipeline stage** — make a disarmed rendition beside an upload and record it on the version, so
   a share or a production can send the rendition. Needs a schema change (owner approval), a
   decision on when it runs (every upload, or on request, or before anything leaves the firm), and
   where the engine runs for large files (a container, rather than a Worker isolate).
3. **Legacy binary Office** — convert to the package form through the office engine, then disarm.
