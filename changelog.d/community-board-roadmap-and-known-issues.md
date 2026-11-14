---
category: Added
audience: internal
---

**The community board's Roadmap and Known Issues.** The Roadmap shows the requests the team has
taken on in five columns (Future, Planned, Building now, Beta, Completed), most-voted first, with no
target dates. Known Issues repeats the public status page's unresolved events with their latest
update and links to the status page; the newest one also shows beside the board's list. The board's
worker reads the status page's own store (`STATUS_KV`, read only) for it, through the same public
merge the status page uses, so the board can never say more than the status page does.
