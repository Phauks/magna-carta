---
category: Fixed
audience: internal
---

`vp run stale-branches` refuses to answer in a shallow clone, covers every remote namespace, and separates branches that hold nothing from branches that hold work.

The landing test starts from `git merge-base`. A clone whose history is truncated cannot find any fork point, so every branch falls through to "not landed" — and nothing says so. Run in a clone cut to fifty commits, the command reported 42 landed of 321 against a true 297: a wrong answer that reads exactly like a right one, in the direction that makes a finished backlog look like 279 live streams. A shallow clone is now refused outright, naming `git fetch --unshallow` as the fix, because the number it would otherwise print is worse than no number.

It also asked the question over `claude/*` only, which left 27 branches in the other namespaces unexamined — including every `docs-sync/*` run and the oldest refs in the repository. It now sorts every remote ref except `main` and `release`, both of which are kept deliberately.

Third, "not landed" was carrying two facts at once. Four branches point at commits `main` already contains, so removing them cannot lose work, but they were reported alongside branches holding real unlanded commits, under a line that said each still held work of its own. Those are now counted apart, with each branch's distance from `main` and last commit date, so the list that needs reading is the short one. The shared landing rule in `tooling/branch-landing` is untouched — its guard is right for the artifact cleaner and the registry, which is why the new split is drawn in the reporter.

The answer today is 310 landed, 4 holding nothing of their own, and 34 holding work.
