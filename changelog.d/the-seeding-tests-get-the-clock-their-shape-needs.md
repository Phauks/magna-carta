---
category: Fixed
audience: internal
---

**The load-profile snapshot tests stop failing on a busy runner.** Every test in `packages/fixtures/test/load-profile-snapshot.test.ts` seeds a real SQLite snapshot — the version-bump case seeds two — and all six ran under Vitest's five-second default, which is sized for tests that compute rather than tests that do a second or more of genuine work. On a loaded node shard that is not enough: the version-bump case timed out twice on one pull request, and it passes in 1.36 s on an idle machine, so what failed was a measurement of the runner rather than anything about the code.

The five seeding tests now carry an explicit `60_000`, matching `load-profile-smoke.test.ts` beside them, which was given the same treatment for the same reason and is why the pattern was already in the file next door. The sixth test seeds nothing and stays on the default, which is honest — it really is a unit test. Sixty seconds is deliberately generous: nothing here measures how fast the seeding is, so a timeout that trips on a slow machine only ever reports the machine.

Nothing about what the tests assert changed. The timeout is the clock, not the claim.
