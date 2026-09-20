---
category: Fixed
audience: internal
---

**A literal U+FFFD in a `u`-flagged regex hangs the linter, and the file carrying it is silently
un-lintable.** `packages/magnus/src/limits.ts` cut a UTF-8 prefix on a character boundary and stripped
the replacement character the cut can leave behind, writing that character as itself. Oxlint never
returns on it. Not slowly — a seventy-line file, no output, still running after two minutes.

The trigger needs three things at once, and the third is the surprising one: a **raw** U+FFFD (the
escape never triggers, and CJK, Latin-1 and emoji never do either), the `u` flag (`/…/` without it is
fine), and the regex being **consumed** — matched, tested, replaced with, or passed through a const
into one. A regex literal that is assigned and never used parses and lints clean. So this is not the
parser; it is the analysis that runs once a pattern is known to be used. Anchors are irrelevant.

The failure is bad out of proportion to its cause because of where it lands. Nothing reports it —
no error, no timeout, no named file, only a pass that does not finish, which reads as a slow machine.
The whole-repository lint died at the same step five times running and was each time put down to
container uptime. Every scoped lint in between passed, because `pnpm check:scoped` lints the diff and
nothing had touched this file since it landed. The gate of record was unrunnable end to end for six
days while every local signal stayed green.

The character is now written as the escape `\uFFFD`, which is the same character to the regex engine.
The whole-repository lint completes in 31 seconds over 4,278 files; magnus's six test files and
fifty-six tests are unchanged, `cutToByteLength("日本語", 4)` among them, which is the mid-character
cut this strip exists for. It was the only raw U+FFFD in first-party source.

Two things this does NOT do, both deliberate. It does not stop the character coming back — nothing
yet rejects a raw U+FFFD on the way in. And it does not fix the linter, which still hangs on this
input for everybody; the escape is a local workaround for an upstream defect that wants reporting.
What would actually pay is neither: a check that cannot finish should fail loudly and name what it was
reading, so the next one of these costs minutes rather than six days.
