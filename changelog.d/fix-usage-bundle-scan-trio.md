---
category: Fixed
---

**Three defects fixed: usage telemetry could fail a served request, a reaped bulk-download bundle could
never be rebuilt, and the malware scanner ran on one container instead of five.** (1) The server-side
usage `reached` event resolved analytics consent and emitted _after_ the route had already committed its
response, with no error boundary — a consent-read failure turned a delivered 2xx into a 500. That work
now runs off the response path and reports any failure through the standard background-failure pipeline,
so telemetry can no longer disturb a served request. (2) The bulk-download coordinator shared any
non-failed job as-is, so once the `bundles/` R2 lifecycle rule expired an artifact the job kept reporting
`ready` with a key that no longer resolved and the bundle could never be rebuilt; the coordinator now
confirms the recorded artifact (or every volume of a split archive) still exists before sharing a `ready`
state, and rebuilds when it is gone — in-flight builds are still single-flighted exactly as before.
(3) Every request to the scan worker addressed one Durable Object name, so the five container instances
it is configured for were unreachable and concurrent scans queued behind a single container; scans are
now spread across one shard per configured instance, keyed on the file version's storage key so a retry
lands on the instance that already handled it. The engine-global histogram read, the file-type identify,
and the warm-poke cron stay on the shard the poke keeps resident.
