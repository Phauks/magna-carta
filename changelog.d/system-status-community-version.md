---
category: Fixed
audience: internal
---

**System Status reads the community board's version, and stops counting Workers that are not bound as missing.** The API Worker now binds `magna-carta-community` (`COMMUNITY_SERVICE`) for the aggregate version read, so its row reports the build it runs. The Workers tile counts the Workers that report against the Workers that are bound and names the unbound ones beside the figure, so a Worker that is not on the account yet, such as `magna-carta-email`, no longer reads as a warning.
