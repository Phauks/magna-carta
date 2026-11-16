---
category: Changed
audience: public
---

**Transactional email sends for real (#413).** `apps/api-worker/wrangler.jsonc` sets `EMAIL_FROM` (`no-reply@magnacarta.esq`), which selects the Cloudflare Email Service adapter over the logging one, and sets `APP_BASE_URL`, which Better Auth now resolves its base URL against. A refused send answers a retryable 503 with an Error ID. Drafted by the docs-sync routine from the merge.

## Public

- Account verification and password-reset emails are now delivered instead of only being logged.
