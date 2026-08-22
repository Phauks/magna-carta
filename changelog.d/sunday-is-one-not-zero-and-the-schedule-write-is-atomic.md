---
category: Fixed
audience: internal
---

**The weekly keep-alive Cron expression was out of range, and the record of why seven weeks of deploys
failed named the wrong cause.**

Cloudflare's cron parser numbers days of the week **1 = Sunday through 7 = Saturday**, where almost
every other implementation reads `0` as Sunday. `NATURAL_LANGUAGE_KEEP_ALIVE_CRON` was `0 4 * * 0` —
not a different-but-valid spelling, an out-of-range value. It is now `0 4 * * 1`.

The schedule write is **one atomic call for the whole set**, so a single malformed expression refuses
every trigger alongside it. That is why "three deploy, five do not" read as a ceiling on the number of
triggers and was recorded in the configuration as one. It was not: the account is on a plan whose
documented limit is two orders of magnitude higher, and the refusal was the set, not the count. The
comments now say so.

**The immediate blocker was simpler than either.** The three-trigger configuration had been correct on
the trunk since 2026-08-21 and had never reached the production branch, so every build was still
carrying the five-trigger set. Pushing the trunk to `release` deployed it successfully — the first
deploy in seven weeks.

**Nothing is added or removed here.** The three live triggers are unchanged and the correction to the
weekly expression is untested against this account, because the deploy that went green carried three
rather than four. Restoring `0 * * * *` alone would settle it: nothing in that expression is
malformed, so a refusal would mean a real ceiling and a success would mean the day-of-week rule was
the whole of it. Either way they go back one at a time, because the atomic write hides which one was
rejected.

Also recorded, because it is the difference between a safe deploy and a silent outage: omitting the
`triggers` key entirely makes the deploy skip the schedule call and leave what is attached alone,
while `"crons": []` writes an empty set and **deletes every schedule**. The five-minute sweep is the
only thing that applies control-plane migrations.
