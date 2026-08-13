---
category: Changed
audience: internal
---

**The quality gate now stops at the first failure.** Matrix fail-fast is on and the heavy jobs (WASM,
Rust, containers) wait on the cheap format tripwire, so one red job stops the rest from spending
runner minutes. The dependency audit is deliberately not gated on it. Part of the temporary CI
austerity, marked for the September 1 revert.
