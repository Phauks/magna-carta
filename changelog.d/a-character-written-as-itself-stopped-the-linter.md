---
category: Fixed
audience: internal
---

**A literal U+FFFD inside a regex literal hangs the linter, and the file it is in is silently
un-lintable.** `packages/magnus/src/limits.ts` cut a UTF-8 prefix on a character boundary and stripped
the replacement character the cut can leave behind, writing that character as itself: `/�$/u`. Oxlint
never returns on it. Not slowly — a seventy-line file, no output, still running after two minutes.

The failure is bad out of proportion to the cause because of where it lands. Nothing reports it: there
is no error, no timeout, no named file, just a pass that does not finish, which reads as a slow
machine or a container that ran out of time. The whole-repository lint died at the same step five
times running and was each time put down to uptime. Every scoped lint in between passed, because
`pnpm check:scoped` lints the diff and nothing had touched this file since it landed.

The character is now written as the escape `�`, which is the same character to the regex engine
and parses. The file lints in under four seconds; its six test files and fifty-six tests are
unchanged, `cutToByteLength("日本語", 4)` among them, which is the mid-character cut this strip exists
for. It was the only raw U+FFFD in first-party source, so nothing else is waiting to do this again —
and the escape carries a comment saying why it is an escape, because the obvious tidy-up is to put the
character back.
