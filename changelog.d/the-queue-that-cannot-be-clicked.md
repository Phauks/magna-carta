---
category: Changed
audience: internal
---

**The merge queue is not on offer here, and the conventions stop promising it.** GitHub offers merge queues only in organization-owned repositories (public, or private on Enterprise Cloud); this repository is private and user-owned, so the setting that #488 documented does not exist for it. The owner declined the transfer that would make it available (2026-09-03), so the deploy-queue entry now records why it cannot be clicked, the decision, and the habit that stands in — one merge at a time, the next branch synced onto the `main` the last merge produced — with the up-to-date-before-merge ruleset option deliberately left off because it spends a full battery per open stream per merge. `build-performance.md`, `operations.md` and `CLAUDE.md` describe the pull-request tier as the only run between a merge and production, which is what is true; the `merge_group` tier stays wired for the day the ownership changes. Recorded as a decision.

**And the node test job stops running into the runner's cap.** On #488's battery the second of two node shards was cancelled at fifteen minutes with every test it had reached passing: the slim runner caps a job at fifteen minutes regardless of the job's own timeout, and the suite has grown to where two shards sit on that line. The job now runs four shards, each well under the cap for the same test minutes.
