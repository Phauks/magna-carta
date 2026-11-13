---
category: Added
audience: internal
---

**Every Worker can read its secrets from the account's Secrets Store.** A secret bound as `SECRETS_STORE_<NAME>` is resolved into the plain value the code already reads, with the Worker's own secret as the fallback, so secrets can move into one account-wide store one at a time with no gap. The deploy runbook says in what order (`docs/conventions/operations.md`, _Secrets Store_).
