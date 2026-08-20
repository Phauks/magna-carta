---
worktree: (primary checkout)
area: Matter time — the listing answered a narrower question than it was asked
status: building
touches: packages/timekeeping/src/queries.ts, apps/worker/src/routes/time-entries.ts, apps/web matters/[id]/time
---

`GET /api/v1/time-entries?matterId=` defaulted its status filter to `draft`, so a caller asking for
a matter's time was answered with its drafts and nothing said so. Approved, submitted, billed and
voided entries on the matter were invisible to any client reading the contract, which declares the
parameter optional with no default.

This stream makes an absent status mean every status, resolves the timekeeper's name in the same
read rather than answering with a user handle, and builds the Time section over it. The page was a
fixture table.
