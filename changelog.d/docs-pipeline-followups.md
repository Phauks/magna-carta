---
category: Fixed
---

**Automated ADR numbering is chronological again.** The `assemble-docs` workflow checked out at the
default depth of one commit, and the assembler orders pending decision fragments by the commit that
first added each file. With no history to read, every fragment scored the same and the tie-break
assigned numbers alphabetically by slug — so each bot-assembled batch of ADRs was numbered in the wrong
order, with nothing failing to signal it. The checkout now fetches full history.

**The active-work registry can see namespaced streams.** Stream notes are named after the branch they
describe, so a `claude/<name>` branch's note lives one directory down — but `vp run worktrees` listed
only the top level of `docs/active-work/`, which meant every nested note was invisible and its stream
reported as having none. The listing now walks the tree, and the twelve notes that had been flattened
to `claude-<name>.md` to work around it are back at the path their branch name dictates.
