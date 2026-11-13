---
category: Changed
audience: internal
---

**The repository is ready to be made public.** A full-history scan of every branch and pull-request ref (gitleaks and trufflehog) found no live credential, so nothing was rotated. What would have been published is removed from the current tree: the real network address in the speed-test tests and plan is now a documentation address (`203.0.113.10`), and the owner's personal mail addresses are gone from the operations runbook and the company-email decision. Every action the workflows use is pinned to a commit rather than a movable tag, because a public repository runs pull requests from forks. A `LICENSE` file states all rights reserved, and `package.json` says `UNLICENSED`.
