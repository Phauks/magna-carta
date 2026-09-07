---
category: Fixed
audience: internal
---

The list of read-shaped POST routes exempt from the audited-mutating rule has one home again.

Two fitness functions ask the same question of the same contract — one reads the document the route table emits, the other the document the running worker serves — and each kept its own copy of the answer. The copies drifted: `uploads.matches` reached one of them and not the other, so the conformance sweep was red on `main` and stayed red. The list now lives in `apps/api-worker/test/support/non-mutating-post-allow-list.ts` with its per-route justifications, and both sweeps read it, so a route earns its exemption once.

The durable-object pragma probes were red on `main` for a plainer reason: they were committed with the assertions still written to reveal the runtime's answer rather than to state it, and one duplicate declaration meant the file did not parse at all. They assert the finding now — that `PRAGMA foreign_keys` does not take effect inside a migration's execution context, that yielding does not rescue it, and that deferral moves the refusal to the commit rather than removing it.
