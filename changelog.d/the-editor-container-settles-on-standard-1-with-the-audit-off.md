---
category: Changed
audience: internal
---

**The editor container settles on `standard-1`, and the image switches the server audit off.** After a week of sizes: `standard-4` cleared the audit's hardware warning and felt no different to use, so the owner kept the smallest size on 2026-09-20 and accepted the warning as the stated consequence. The warning counts as an error to the audit, and with `IsAdminUser` true for every member it would put the "Check warnings of your server" snackbar over every open, so `disable_server_audit=true` joins `extra_params`; there is no per-line switch. Taking it out for one deploy brings the audit back for a diagnosis. `docs/operating-costs.md` carries the sizes and what each buys.
