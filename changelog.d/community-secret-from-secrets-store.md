---
category: Changed
audience: internal
---

**The community board's sign-in secret now comes from the account's Secrets Store.** `magna-carta` and `magna-carta-community` both bind `COMMUNITY_HANDOFF_SECRET` from the store, so the one value is kept in one place instead of being set on each Worker.
