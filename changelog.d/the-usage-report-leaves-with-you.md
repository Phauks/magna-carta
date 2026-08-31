---
category: Changed
audience: public
---

The Firm Usage masthead byline and page footer are removed on the owner's direction (the tables are
the page), and a Download Report action renders the same response the tables drew as a dated
plain-text file (`$lib/tools/firm-usage/firm-usage-report.ts`, unit-tested). Also fixed at the
shell: the work canvas is now `position: relative`, so an absolutely positioned descendant (a
screen-reader-only table caption on any tall page) resolves against the canvas and clips with it,
instead of stretching the document into a second window scrollbar with bare background beneath the
shell.

## Public

**Firm Usage is tighter, and the report leaves with you.** The page is now just the tables, and
**Download Report** saves everything on it as a dated plain-text file you can keep or paste into an
email. A display bug that gave tall pages a second scrollbar and a blank band beneath the app is
fixed everywhere.
