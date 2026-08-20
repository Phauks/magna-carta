---
worktree: (primary checkout)
area: Matter costs — the same silent narrowing as time, and a fixture screen
status: building
touches: apps/worker/src/routes/costs.ts, apps/web matters/[id]/costs, apps/web/src/lib/matters/cost-api.ts
---

`GET /api/v1/costs?matterId=` defaulted its status filter to `draft`, exactly as the time listing
did before #333. A matter's approved, invoiced and voided disbursements were invisible to any
client reading the contract, which declares the parameter optional with no default.

This stream removes the narrowing, resolves the vendor's directory name in the same read, and
builds the Costs section over it. The page was a fixture table.

Measured while here: these two were the only filter-narrowing defaults in the route surface. The
seven other `query.x ?? y` sites are page sizes and explicit nulls, so no gate is warranted.
