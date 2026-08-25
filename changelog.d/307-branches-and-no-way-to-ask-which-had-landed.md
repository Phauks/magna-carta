---
category: Added
audience: internal
---

`vp run stale-branches` — which remote `claude/*` branches have delivered their work and can go.

307 had accumulated. Nothing could answer the question: `vp run worktrees` asks it only over branches the registry knows about, so a branch whose note was retired is invisible there, and those are exactly the ones that pile up.

Git's obvious answers are worse than nothing here. This repository squash-merges, so a landed branch is never an ancestor of `main` and `git branch --merged` reports almost none of them. The merge-tree shortcut — merge into `main` in memory, check the tree is unchanged — is right only on the day a branch merges; once `main` touches any file that branch touched it answers "not landed" forever. Sampled against fourteen branches that provably landed, it got thirteen wrong. The command uses the walk-forward test in `tooling/branch-landing` instead, which asks WHERE the content landed and therefore never expires.

It deletes nothing, and says so: retiring is still `vp run retire-note`, and a branch reported as landed may be somebody's live workspace on another machine. The answer today is 283 landed, 24 not.
