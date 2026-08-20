---
category: Fixed
audience: internal
---

**`pnpm fix:scoped` deleted type assertions the code needed, and the file stopped compiling.** The
rewrite strips the shape assertion off `await response.json()` in the worker's route tests. It is
reproducible: two assertions in, zero out, ten TS2571 errors on a file that type-checked a moment
earlier, and it reaches every such assertion in the file rather than only the ones just written.

The two tools disagree about the same call. `typescript/no-unnecessary-type-assertion` reads
`.json()` as returning `any`, against which any assertion is a no-op worth deleting; the type-check
of record resolves it to `unknown`, against which the assertion is the only thing making the
property access legal. The fixer trusts its own answer and rewrites.

It joins the two rewrites already held back from the unattended fix pass. The finding still shows in
every check path, as those do — seeing it and deciding is the point; having it applied while you
look away is not.
