---
category: Changed
audience: internal
---

**The Google Places key is read from the Secrets Store.** The app worker binds `GOOGLE_PLACES_API_KEY` from the Cloudflare Secrets Store, with a per-Worker secret as the fallback, and the System Status page now counts the Google key as setting address suggestions up.
