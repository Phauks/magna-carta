---
category: Fixed
audience: internal
---

**`packages/document-assembly` failed its own purity gate**, so the test battery was red on `main` from the moment the template library merged. The catalogue's server-side search reaches for `@magna-carta/data-access/like-search`, and that specifier was not on the package's allow-list of externals.

The import is right and the allow-list was incomplete, so the allow-list moved. `like-search` is pure string work — three functions, no imports of its own, no database handle, no runtime — which is the same standard as the four `@magna-carta/data-access/*` specifiers already listed. More to the point, restating the rule inside the assembly core is precisely the defect that module was created to end: escaping `%` and `_` before they reach a `LIKE` is a correctness rule, it had already been written twice and agreed by luck, and a third copy here would have been the one that missed the next correction.
