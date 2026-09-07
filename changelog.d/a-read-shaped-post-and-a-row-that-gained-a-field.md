---
category: Fixed
audience: internal
---

**The three tests standing red on `main` are green again, both causes in the expectations rather than in shipped behaviour.** `uploads.matches` asks whether the firm already holds a file's bytes before they are sent, which is a read wearing a POST's clothes: it declares `audited: false` with that reasoning stated at the route, and the two conformance fitness functions that hold every mutating method to `x-mc-audited: true` had no entry admitting it. It is now on the non-mutating allow-list in both copies — the register the emitted document is checked against and the mirror applied to the live-served one — carrying the same rationale the route does. The operation id was already in the same file's permission-registry inventory, which is a different list and is why the name greps as present while the assertion still failed.

The firm-database health row gained a `fault` when the panel learned to say why a database is not answering, and the unreachable-path test still asserted the two-key shape with `toEqual`, where its neighbours use `toMatchObject` and absorbed the third key silently. It now asserts the fault as well, so the field that turned an outage into a message naming the failing statement is covered rather than merely tolerated.
