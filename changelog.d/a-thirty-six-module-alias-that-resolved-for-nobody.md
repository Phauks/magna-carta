---
category: Fixed
audience: internal
---

**`main` was red on a second count nobody had traced: the web app's test project could not resolve
`$lib` at all. Seventeen tests had never run.**

`apps/web/vitest.config.ts` uses a plain node pool and deliberately leaves SvelteKit's plugin out —
it never runs a dev server or a build, and the comment at the top explains why. What the comment did
not account for is that `$lib` is SvelteKit's alias, and its plugin is the thing that resolves it.
`.svelte-kit/tsconfig.json` maps the alias for the type-checker, so the code type-checks; at test
time nothing mapped it at all.

Thirty-six modules under `src/lib` import through the alias. Any test reaching one of them dies at
load with `Cannot find module '$lib/…'` — a whole-file failure that reads like a missing dependency
rather than a missing config line, which is most of why it went untraced. Only one suite reached
one, so the hole waited for `create-document.test.ts` to be written and then looked like that
suite's problem.

The config now declares the alias itself, independent of SvelteKit and matching what the generated
tsconfig maps. `create-document.test.ts` passes, 17 tests; the whole web project passes, 380.

**A guard, not just a fix.** `test/lib-alias.test.ts` imports _through_ the alias, so the hole
cannot reopen quietly — verified to fail with `Cannot find module '$lib/api/request.ts'` when the
alias is removed, and to pass when it is there.
