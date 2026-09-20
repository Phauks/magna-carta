---
category: Added
audience: internal
---

**`pnpm gate` gives every step a time budget, and reports a step that exceeds it as `NO END` rather
than as a failure.** A check that never returns is indistinguishable from a slow machine: no error, no
exit code, no file named, only a command that has not come back. That ambiguity cost six days in
September 2026 — one character in one seventy-line file made the `lint` dimension non-terminating, it
was put down to container uptime five separate times, and the gate of record could not be run end to
end the whole while. The character was a one-line fix. Finding it was the entire cost.

A timeout is its own outcome and never folded into `FAILED`, because a dimension that did not finish
reached **no verdict**: the change is unverified rather than bad, and the next move is different. The
message says so, and says what to do — halve the step's inputs, keep the half that hangs — rather than
leaving a reader to conclude their machine is tired.

Budgets are per **step**, not per dimension: the step is what hangs and what can be named, and capping
the dimension would kill honest work in a long one to catch a hang in a short one. They are set well
past the slowest legitimate run, because what they catch does not terminate at all — any finite budget
detects it, and the only way this can do harm is by firing on real work. The test battery's budget is
deliberately the same 90 minutes the test lock already treats as past the slowest run; a test asserts
the two never disagree. `MAGNA_CARTA_GATE_TIMEOUT_SCALE=2` doubles them, `=off` removes them, and a
value it cannot read is an error rather than a quiet fallback to unscaled.

**The teardown is the half that is easy to get wrong.** The gate never holds a handle on the process
doing the work — under `vp` sits the lint or test CLI, and under that the worker threads and esbuild
services — so killing the direct child orphans the rest onto init with the CPU and the caches still in
hand. `spawnSync`'s own `timeout` does precisely that, and it is not theoretical: the morning this was
written, two `vp check` processes from the previous day's killed runs were still resident, and a fresh
lint that should have taken three seconds sat at 0.1% CPU behind them. Steps therefore lead their own
process group and are torn down through the bounded ladder the test guard already proved. A test spawns
a parent that spawns a grandchild and asserts the grandchild is gone; it fails when group-leading is
disabled, so it is testing the thing it claims to.
