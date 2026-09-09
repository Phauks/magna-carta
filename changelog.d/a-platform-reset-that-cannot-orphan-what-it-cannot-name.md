---
category: Added
audience: internal
---

**`reset-platform.mts` — the pre-launch clean slate, ordered so it cannot strand a resource.**

Destroying a firm's resources is not a fan-out, it is a sequence, because nothing outside the control
plane can enumerate what a firm owns: there is no API that lists Durable Object instances, and
`ai_search_instance` is deliberately the only index of the managed search instances
(control-plane-schema.ts: "Nothing ever calls the service's list operation"). Empty the control plane
first and every bucket and every search instance survives with nothing able to name it — still
running, still billed, against an account ceiling of 5,000 for the instances. So the control plane
goes last, and the script refuses to touch it while any search instance is still live, or if any
bucket failed to delete.

Three details worth keeping: the table list is read from `sqlite_master` rather than written down, so
a table added later cannot silently survive the wipe; each firm's key is crypto-shredded first,
because it is the one step whose value survives a later failure; and the firm databases themselves
are left unaddressed rather than wiped, since clearing Durable Object storage needs a route that
would outlive its one use. Dry run unless `--destroy` is passed AND the account id is typed out.
