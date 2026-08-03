---
category: Changed
---

- **CI lint job now fails fast on a genuine type-aware deadlock.** The gate's type-aware `lint` job
  (oxlint + tsgolint) had no `timeout-minutes`, so a tsgolint deadlock or runaway would have run to
  GitHub Actions' 6-hour default before failing. Added `timeout-minutes: 45` — comfortably above the
  ~24-minute whole-repo tall pole, so normal runs are unaffected but a real hang fails visibly in
  minutes instead of burning the runner. (Diagnosed while investigating a slow local `apps/worker`
  type-aware run: it is CPU-bound, not deadlocked — the worker's type program spans ~32 packages, so
  it is simply the documented tall pole. The guard defends against a _future_ genuine deadlock.)
