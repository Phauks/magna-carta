---
category: Changed
---

- **The gate's lint hang guard is re-measured and raised — it had grown tight enough to fail honest
  runs.** The type-aware `lint` job was capped at `timeout-minutes: 45`, set when the whole-repo pass
  took ~24 minutes. Re-measured on today's tree, that pass takes **~45 minutes** (0 errors, ~820
  advisory warnings across ~1850 files, 4-core/16 GB box) — the repo has roughly doubled the tall pole
  as packages were added, so the cap had drifted from "comfortably above the honest time" to just
  under it, and the merge and scheduled tiers (the ones that pay the whole-repo pass) were at risk of
  being killed mid-run and reported as a red gate. Raised to 75 minutes, still far below GitHub's
  6-hour default, so a genuine tsgolint deadlock fails fast while an honest slow run completes. Pull
  requests are unaffected — they lint the affected packages plus one hop, which is seconds to minutes.
  Every place quoting the stale ~24-minute figure (`tooling/affected-lint`, the gate comments,
  [`docs/conventions/build-performance.md`](docs/conventions/build-performance.md)) now carries the
  measured number and says to re-measure rather than trust it.
- **The lint ruleset's documented home matched the config again.** `docs/conventions/typescript.md`
  listed `eslint/no-await-in-loop` as off (it is on, as a `perf` warning) and called `correctness` a
  hard error in one paragraph while the next said it keeps its inherited advisory severity. Both are
  corrected against the live `vite.config.ts`, and `oxc/no-barrel-file` is now stated as the one rule
  set to error.
