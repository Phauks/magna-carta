---
category: Fixed
audience: internal
---

**`pnpm fix:scoped` no longer rewrites an annotated array constant into a `Set` and leave the
annotation behind. Five separate passes had to notice the same non-compiling rewrite and undo it by
hand.**

`unicorn/prefer-set-has` fires on a constant that is only ever membership-tested, and its autofix
rewrites both halves of the pattern: the initializer becomes `new Set([...])` and the `.includes()`
call becomes `.has()`. What it does not touch is the declaration's type annotation. On
`const KEYS: readonly string[] = [...]` the result is a file that lints clean and does not compile —
TS2740 on the declaration, because a `Set` is not an array, and TS2339 on the call, because `has`
does not exist on one.

The live example is `APPEARANCE_STORAGE_KEYS` in the design system's theme-preference module, which
the fix pass reaches whenever a change touches that file. The rule is now on the fix-pass exclusion
list in `tooling/check-scoped/unsafe-autofix-rules.mjs`, alongside the three rewrites already there.
The exclusion is fix-pass only: `pnpm check:scoped`, `pnpm check` and the editor still report the
finding, they simply stop applying it unattended.
