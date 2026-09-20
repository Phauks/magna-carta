---
category: Changed
audience: internal
---

**The editor container is `standard-4` for one round, to see the audit's hardware warning clear.** coolwsd sets that warning whenever the kernel shows it fewer than four threads; `per_document.max_concurrency` cannot clear it, since it is only ever clamped down to the thread count, and the audit's only override (`disable_server_audit`) switches the whole audit off. Four vCPUs is the smallest instance that shows four threads, so this is the experiment; the owner's standing ruling is the `standard-1` price, and the container returns there once the audit is read. `docs/operating-costs.md` carries the figures.
