---
category: Added
audience: internal
---

**A design for the Worker fleet: what the core Worker stops carrying, where the hosts go, and why the
API and the orchestration stay one program.**

Fifteen entries under `apps/` are three different kinds of thing — entrances, the core, and engines —
and nothing said so. The design names the kinds, records that `apps/api-worker` is the naming convention
applied to the root script rather than an oversight, and refuses the split of the API from the
orchestration on the one fact that settles it: `FirmDatabase` is a Durable Object on that script and
is each firm's database.

The segmentation that is worth doing is different. The core Worker still imports three WebAssembly
packages whose work belongs at Workers that already exist — PDF at the signing Worker, decryption at
the recovery Worker, message parsing at the mail entrance. Moving them makes the slowest build in the
repository need no Docker at all.

It also records that the host cutover was never blocked. `magnacarta.esq` has been a live zone since
June and the status Worker already holds a custom-domain route on it; a stale comment claiming
otherwise is what made it look gated. The design orders the cutover so the `assets` block stays as the
rollback until both hosts are confirmed serving, and names the two same-origin assumptions that stop
being true when the application and the API move to different subdomains.
