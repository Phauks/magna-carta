---
number: 411
slug: a-data-export-is-one-document-and-a-format-is-a-renderer
status: Proposed
date: 2026-08-31
area: Cross-cutting
summary: "Exporting a screen's data is one framework, not a per-page feature: a surface builds a single tabular export document (title, timestamp, table sections) from exactly what it shows, and each download format is a renderer over that document. Plain text and CSV render client-side today under $lib/export; the other asked-for formats are named seams with stated prerequisites rather than second implementations — a native spreadsheet (.xlsx) waits on a deliberate library adoption, and Word/PDF belong to document assembly server-side, because the office suite is the platform's one renderer of a word-processing package and its conversion edge is the one way a PDF gets made. The Firm Usage report is the first consumer; the owner asked whether export should be a common framework, and this records the yes and its shape."
---

**A download must carry exactly the figures the screen showed, in whatever format the reader's next
tool wants — so the figures are assembled once and the formats are interchangeable renderers.**

**Context:** The Firm Usage screen shipped with a plain-text report download. The owner asked for
CSV, Excel, Word, and PDF, and asked whether export should be a larger common framework. Financial
reporting, the custody registers, and the conflicts report will all face the same ask, and a
per-page answer would give the platform as many export implementations as screens.

**Decision:**

- **One document shape, built from what the screen shows.** `$lib/export/tabular-export.ts` defines
  the tabular export document: a title, a generation instant, and table sections. A surface builds
  it through the same formatters its on-screen tables use, so a file and the screen cannot
  disagree, and stated absences ("Not yet measured") travel into the file rather than dropping out.
- **A format is a renderer.** `render-text.ts` (aligned plain text) and `render-csv.ts` (byte-order
  mark, CRLF, RFC 4180 quoting — what spreadsheet applications actually require) render
  client-side. Adding a format touches no page.
- **Filenames are stamped to the second** (`<slug>-YYYY-MM-DD-HHMMSS.<extension>`), because exported
  figures recompute on every read: two downloads are two snapshots and must sort and read apart.
- **Native .xlsx is deferred behind a library decision, not built badly now.** Writing OOXML by hand
  is fragile, and the candidate libraries are large dependencies the platform adopts deliberately.
  CSV opens in Excel and covers the spreadsheet need meanwhile.
- **Word and PDF exports are document assembly's to produce, server-side, when wanted.** The office
  suite is the platform's one renderer of a word-processing package, and the assembly worker's
  conversion edge is the one way a PDF gets made — a client-side PDF or .docx generator would be a
  second answer to what the firm's documents look like, which is exactly what those rules exist to
  prevent. The export document is the input a future assembly-backed renderer takes; the seam costs
  nothing to keep.

**The .xlsx library evaluation (2026-08-31), on the owner's ask.** Two candidates compared:

- **exceljs 4.4.0** — MIT, ~11.6M weekly downloads, but the last release is October 2023, the
  maintainers describe the project as inactive (655 open issues, 140 open pull requests, a
  community fork soliciting maintainers), and Snyk lists four UNFIXED advisories against every
  released version, one critical (prototype pollution) and two high. It carries nine direct
  dependencies (jszip, archiver, unzipper, tmp, fast-csv, and more), several of them Node-shaped,
  and a large bundle. Adopting a package with standing unfixed advisories would fail the
  platform's own dependency-advisory posture on day one. Rejected.
- **write-excel-file 4.x** — MIT, actively released (latest within three months), one production
  dependency (fflate, pure JavaScript, ~10 KB gzipped), a browser-first build with a `.toBlob()`
  output that drops straight into the export seam's save path, TypeScript definitions, and the
  feature set the tabular document needs: multiple worksheets (one per section), typed number
  cells with number formats, bold, borders, column widths, and frozen header rows. Caveats worth
  recording: a single maintainer, primary hosting moved to GitLab with GitHub as mirror, and a
  recent 4.0 major — so the version is pinned exactly and the renderer isolates the library behind
  the one `render-xlsx` module. **Recommended.**

The renderer loads lazily (dynamic import on first use) so no page pays the library's weight until
someone exports a spreadsheet.

**Adopted (2026-08-31).** The owner weighed the field — exceljs (rejected: inactive since 2023 with
four unfixed advisories, one critical), SheetJS CE (credible and maintained, but styling sits in
the paid Pro tier and current versions install only from the vendor's own registry), and
xlsx-populate (no known advisories and a clean API, but no release since March 2020) — and adopted
**write-excel-file, pinned exactly at 4.1.1**. The caveats stand recorded: a single maintainer and
GitLab-primary hosting; the renderer isolates the library behind `render-xlsx.ts` and imports it
lazily, so replacing it is one module. The export document's cells grew a second face for this
renderer: a figure carries its formatted text (what text and CSV print) and its raw number (what
Excel writes as a real cell), so a column of counts sums in a spreadsheet.
