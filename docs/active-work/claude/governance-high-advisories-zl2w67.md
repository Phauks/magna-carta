---
worktree: /home/user/magna-carta (remote session)
area: The merge queue is not on offer to a user-owned repository; the deploy-queue entry, the conventions and CLAUDE.md say so and record the serial-merge habit that stands in
status: review
touches: .github/workflows/gate.yml, docs/deploy-queue.md, docs/conventions/build-performance.md, docs/conventions/operations.md, CLAUDE.md, docs/decisions/pending/, changelog.d/
---

Fifth stream on this branch, restarted from `main` after #488 landed. Docs only: the owner declined the repository transfer that a merge queue needs, so every place that described the queue as pending now describes the pull-request tier as the only run between a merge and production, with the decision recorded once on the deploy queue and as a pending ADR. The one workflow change is the node test job's shard count (two to four), because the slim runner's fifteen-minute cap cancelled a shard on #488's battery; the `merge_group` tier stays wired. Cross-cutting files are touched deliberately; nothing else in flight declares them.
