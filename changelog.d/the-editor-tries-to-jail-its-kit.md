---
category: Changed
audience: internal
---

**The editor image no longer switches off `security.capabilities`.** An experiment the owner asked for on 2026-09-19 to clear the server audit's "Documents are not effectively contained" line: with the setting at its default, coolwsd first tries a user and mount namespace for the kit, and failing that needs the file capabilities the image sets on coolforkit. The Dockerfile's note carries the two outcomes to read after the deploy and the one-line revert (`--o:security.capabilities=false` back into `extra_params`) if no document opens.
