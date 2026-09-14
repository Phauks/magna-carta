---
category: Fixed
audience: internal
---

The lint cost proxy stops counting work nobody does.

CI does not lint the whole repository on a pull request. It lints a computed scope, and it defers the one package whose lint is effectively a whole-repo lint — `apps/api-worker` — to the post-merge pass. Which package that is gets decided by a cost proxy: the number of lintable files the type-aware linter has to pull into a type program.

The proxy counted every file in a package's dependency closure, tests included. A dependency's tests are never pulled into a dependent's type program, because nothing imports a test — so across api-worker's 61-package closure that was 609 phantom files, 30% of the one number the rule is decided by. Its weight falls from 2022 to 1413 once they are dropped. A package's own tests still count, because linting a package does lint them.

The share that selects a sink moves from 0.50 to 0.35 in the same change and not independently of it: on the honest numerator, api-worker is 46% of the workspace rather than 65%, so at 0.50 it would have stopped being selected and the deferral would have become a silent no-op. The new share is set from measured lint time rather than from the proxy that was in question — api-worker takes 11.7s against 2.6s for `apps/web` and 1.4–2.1s for a typical domain package, and its per-file cost is superlinear, so a file-count proxy understates the outlier it is picking.

Two guards that compared a sink against its neighbour, or against how far past the bar it sat, are gone. Both fired on ordinary growth in `apps/web` rather than on anything about the deferral, and one could have deselected the expensive package while keeping a cheaper one. Selection is already the outlier test; what is left asserts the two failure modes worth failing on — no sink selected, so the deferral does nothing, and more than two, so it has stopped being about outliers. Simulated against this dependency graph, the rule now stays green from today through +1200 files in `apps/web`, while `apps/web` joins as a genuine second sink and api-worker eventually ages out of one.

Separately: a package with no lintable files of its own can never be a sink. `apps/web-worker` has zero and depends only on `apps/web`, so it carried `apps/web`'s weight exactly and forever — deferring it would defer no work while spending one of the two sink slots.
