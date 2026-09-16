---
category: Fixed
audience: internal
---

**The repo-wide fitness sweep reaches CI.** `tooling/check-scoped/repo-wide.mjs` has always defined the repo-wide set as two halves — the `lint:*` scripts, and the Vitest checks that self-register with an `@repo-wide-fitness` directive — and the gate's `governance` job called only the first. The second half is where the encryption chokepoint scan (`no-plaintext-escape`), the telemetry console ban, the design system's off-token and `bits-ui` boundary scans, the PII registry coverage check and the schema conformance checks live; twenty-six members in all.

They were not unenforced, exactly: each runs under its own package's Vitest project. But the test battery is asked for on a pull request rather than automatic — the `run-tests` label, always on a queued merge — so on an unlabelled pull request nothing looked at them and the first report came from the merge queue, which is the most expensive place to learn that a protected-field read escaped its chokepoint.

The sweep is now a step of its own in `governance`, both scopes, unconditional: about four seconds for twenty-six read-only scans in one un-isolated process. Deciding whether to run it would cost more than running it. `lint:lints` holds the workflow's `MAGNA_CARTA_FITNESS_SCOPES` value identical to `FITNESS_SCOPES_ENV` in the module, so a rename cannot quietly halve what the sweep covers.

The derivation was never the problem and is worth restating: neither half has a roster, and adding a check to either is a line in `package.json` or a comment in the check's own header. A derived set still has to be called, and this one was half-called for as long as it existed.
