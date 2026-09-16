---
category: Fixed
audience: internal
---

**Svelte accessibility findings fail the build.** `svelte-check` exits zero on warnings, and every accessibility rule the Svelte compiler carries reports as a warning — so for as long as both `check` scripts ran bare, nothing enforced them. The Storybook axe pass is real, but it sits in the test battery, which a pull request has to ask for.

Both packages now run `svelte-check --threshold warning`. The adoption cost was one suppression: the design system was already at zero warnings over 3,145 files and the SPA at one over 3,949. That one was `state_referenced_locally` in the matter's activity register, where the variant is a literal at both call sites and reading it once is correct — so it took the documented `svelte-ignore` the catalogue screen already uses, with the reason written beside it, rather than a change in behaviour.
