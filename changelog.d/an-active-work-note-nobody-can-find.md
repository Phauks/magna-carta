---
category: Fixed
audience: internal
---

**The instruction that creates an active-work note is shorter than the note format, and the
difference is the part that makes the note findable.** `CLAUDE.md` said to add
`docs/active-work/<branch>.md` with a scope and the files you expect to touch. The registry needs
two more things: the path must mirror the branch exactly, slashes included, and the file needs a
frontmatter block. A note that misses either is not rejected — it is simply never read, so the
stream it describes warns nobody and `vp run retire-note` cannot find it afterwards to clean it up.

The registry already detects both failures and names them, in a section written precisely for this
case. It is only reached by running `vp run worktrees`, which the instruction did not say to do.
Now it does, and the two requirements are stated where the note gets written rather than only in the
format document.
