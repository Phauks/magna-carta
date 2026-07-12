# corpus-ci sources

The authoritative manifest for every PDF committed under `corpus-ci/` — the
small, redistributable corpus the OCR benchmark and the CI smoke/parse gates
run against without a network fetch. `crates/pdf-eval/corpus.lock` covers the
separate gitignored `corpus/` and `corpus-forms/` sets; this file is the one
home for `corpus-ci/` itself.

Most files come from the Mozilla `pdf.js` test corpus (Apache-2.0), fetched
from a single pinned commit so the set is reproducible rather than drifting
with `pdf.js`'s `master` branch:

```
https://raw.githubusercontent.com/mozilla/pdf.js/<commit>/test/pdfs/<name>
commit: c4574a5470d83c03b1b50b7688edd5e34d1ae739
```

| filename                                  | origin                                                                        | sha256 (first 16 hex) | bytes  | description                                                                                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------- | --------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `basicapi.pdf`                            | pdf.js `test/pdfs/basicapi.pdf`                                               | `925853d98d67d5da`    | 105779 | Table-of-contents style prose, the original benchmark seed document.                                                                  |
| `pdfjs_franz_image.pdf`                   | pdf.js `test/pdfs/franz.pdf`                                                  | `050ae194d21d9b25`    | 2805   | Tiny "Hello World" page with an embedded raster image.                                                                                |
| `gov_irs_w9_acroform.pdf`                 | `https://www.irs.gov/pub/irs-pdf/fw9.pdf` (US Government work, public domain) | `2d420cbb4123dcf1`    | 140815 | Real IRS Form W-9: interactive AcroForm fields plus instructional prose.                                                              |
| `ArabicCIDTrueType.pdf`                   | pdf.js `test/pdfs/ArabicCIDTrueType.pdf`                                      | `1cad1de912ba29f8`    | 39370  | CID TrueType font rendering Arabic script — the corpus's non-Latin/right-to-left coverage.                                            |
| `annotation-text-widget.pdf`              | pdf.js `test/pdfs/annotation-text-widget.pdf`                                 | `9f091ceb368ad040`    | 93171  | Text-field annotation widgets: short, structured field-label text distinct from prose or a filled government form.                    |
| `chrome-text-selection-markedContent.pdf` | pdf.js `test/pdfs/chrome-text-selection-markedContent.pdf`                    | `256551a6dabf4ae2`    | 137291 | Multi-paragraph financial-guidance prose behind marked content — the corpus's largest single-column prose sample.                     |
| `issue10640.pdf`                          | pdf.js `test/pdfs/issue10640.pdf`                                             | `2f07579b9f8044cb`    | 50264  | LaTeX-produced document (Open Sans / Computer Modern-family fonts) — font-rendering variety distinct from the other samples' fonts.   |
| `issue10900.pdf`                          | pdf.js `test/pdfs/issue10900.pdf`                                             | `54f5e3a559cc7c05`    | 34085  | A dense numeric table (rows of decimal figures) — a reading-order case shaped nothing like prose.                                     |
| `issue11045.pdf`                          | pdf.js `test/pdfs/issue11045.pdf`                                             | `16e57e98a1a5560f`    | 40875  | An academic figure caption, the kind of short annotated-diagram text found in multi-column papers.                                    |
| `issue11913.pdf`                          | pdf.js `test/pdfs/issue11913.pdf`                                             | `996da6eebc2c0448`    | 33577  | A real Irish Supreme Court judgment ([2001] IESC 63) — single-column legal prose, on-theme for a legal practice-management benchmark. |
| `issue13242.pdf`                          | pdf.js `test/pdfs/issue13242.pdf`                                             | `1c0f8198544f5485`    | 27635  | Lorem-ipsum placeholder text set across multiple typefaces — a typography/font-variety sample.                                        |
| `issue1350.pdf`                           | pdf.js `test/pdfs/issue1350.pdf`                                              | `bea02a5e94be1ffb`    | 118396 | A membership/rental agreement — contract-style prose, another legal-adjacent document shape.                                          |

## Candidates downloaded and rejected

Verified via `Document::load` + `page_text_glyphs(0)` before committing;
rejected when page 0 carried no or negligible extractable text (the born-
digital, ground-truth-bearing bar this benchmark needs), or when a kept file
already covered the same shape:

| filename                                                        | page-0 ground-truth chars | reason rejected                                                                                                                          |
| --------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `90ms_rksj_h_sample.pdf`                                        | 16                        | Below the 40-character bar; would have been the CJK sample but `ArabicCIDTrueType.pdf` already covers non-Latin script with more signal. |
| `arial_unicode_ab_cidfont.pdf`                                  | 4                         | Glyphs decode to `U+FFFF` (font has no usable ToUnicode/cmap) — not real recoverable text.                                               |
| `arial_unicode_en_cidfont.pdf`                                  | 0                         | No extractable text on page 0.                                                                                                           |
| `bug1947248_forms.pdf`                                          | 16                        | Below the bar, and near-duplicate of `bug1947248_text.pdf`.                                                                              |
| `bug1947248_text.pdf`                                           | 16                        | Below the bar.                                                                                                                           |
| `cid_cff.pdf`                                                   | 23                        | Below the bar.                                                                                                                           |
| `doc_1_3_pages.pdf` / `doc_2_3_pages.pdf` / `doc_3_3_pages.pdf` | 15 each                   | Below the bar, and near-identical to each other.                                                                                         |
| `file_pdfjs_form.pdf`                                           | 54                        | Clears the bar but is a thin near-duplicate of `annotation-text-widget.pdf`'s form-field coverage.                                       |
| `form_two_pages.pdf`                                            | 1                         | Effectively no text on page 0.                                                                                                           |
| `freetexts.pdf`                                                 | 134                       | Clears the bar but is a thin, repetitive near-duplicate of the widget/annotation coverage already kept.                                  |
| `issue10301.pdf`                                                | 12                        | Below the bar (a Hebrew sample; too little text to be useful even as script coverage).                                                   |
| `issue10402.pdf`                                                | 5                         | Below the bar.                                                                                                                           |
| `issue11651.pdf`                                                | 0                         | No extractable text on page 0.                                                                                                           |
| `issue12705.pdf`                                                | 24                        | Below the bar (another thin Hebrew sample).                                                                                              |
| `issue12706.pdf`                                                | 412                       | Clears the bar but redundant with the AcroForm/prose coverage `issue1350.pdf` and `annotation-text-widget.pdf` already provide.          |
| `issue12798_page1_reduced.pdf`                                  | 0                         | No extractable text on page 0 (image/vector content only).                                                                               |
