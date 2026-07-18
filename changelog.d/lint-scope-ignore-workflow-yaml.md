---
category: Changed
---

The gate's affected-lint scoping no longer treats a `.github/` change as a global trigger. A workflow or action YAML edit (e.g. `gate.yml`) cannot move a type-aware lint result, so it no longer forces the ~24-minute whole-repo lint — a CI-config change now runs the fast scoped lint (or none) like any other non-lint-input change. A genuinely lintable JS/TS file under `.github/` (a JS-based action) still forces a whole-repo lint via the existing "lintable source outside any package" rule, so there is no soundness gap.
