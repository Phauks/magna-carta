---
category: Changed
---

The TypeScript standard-library level every package compiles against moved from ES2022 to ES2023.
Nothing about the running product changes — this setting only tells the compiler which built-in
methods exist, and the emitted code is byte-for-byte what it was.

It matters because the old setting had started producing real breakage. The repository's own
autofixer rewrites `array.sort()` into the safer non-mutating `array.toSorted()`, which is exactly
the right change to make; but `toSorted` is an ES2023 method, so in a package pinned to ES2022 the
compiler then rejected the very code the linter had just written. The workaround was to remember not
to let the autofixer run in most of the repository, and to undo it by hand where it had. Thirteen
such rewrites had already slipped through, leaving the main branch unable to typecheck.

The pin was the anachronism, not the methods. This project requires Node 22 and runs on a Cloudflare
runtime dated mid-2026; both have supported these methods for years. Raising the level fixes the
thirteen sites at a stroke, and turns the autofixer from something to be worked around into something
that can simply be trusted.
