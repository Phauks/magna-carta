---
category: Changed
audience: internal
---

**Usage analytics reads its key from the Secrets Store.** `USAGE_ANALYTICS_PEPPER` is now bound from
the account's Secrets Store as `SECRETS_STORE_USAGE_ANALYTICS_PEPPER`, with the per-Worker secret as
the fallback, so creating it in the store is the one step that switches usage events on in the
Workers Analytics Engine dataset. The System Status steps and `docs/conventions/operations.md` (Usage
analytics) say how.
