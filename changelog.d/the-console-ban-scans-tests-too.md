---
category: Fixed
audience: internal
---

The discovery processing slice landed a load-profile measurement harness that prints its latencies,
and the console-ban fitness function failed on `main` the moment it merged. The harness is the same
class as the measurement CLI already on the allowlist — a developer tool whose stdout is its product,
printing machine-relative numbers precisely because asserting them against a threshold would turn a
busy laptop into a red build — so it joins the allowlist rather than losing the print.

Two things this exposed rather than caused. The ban scans `src/`, which includes a `.test.ts` living
there, so a measurement test is held to a rule written for application code; the existing measurement
files avoid it only by keeping the logic in a plain module and letting the allowlisted CLI do the
printing. And the ban's own comment said "the ONLY two source files" above a list of five.

It merged green because the check that catches it lives in `packages/telemetry` and the verification
run covered the packages the change touched. A repository-wide fitness function is not in the package
whose code it governs, so scoping a test run by the diff can skip it entirely.
