---
category: Fixed
---

Per-merge docs assembly no longer fails the gate on unformatted output. The `build-decisions` assembler rewrites `ADR-<slug>` references to their assigned `ADR-NNNN` numbers across the docs, which changes text width inside Markdown tables and breaks the column alignment the formatter enforces. The `assemble-docs` workflow now runs the formatter (`vp check --no-lint --fix`) on the assembled output before opening its pull request, so the assembly PR is always format-clean regardless of which files the assemblers touch.
