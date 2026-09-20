# api-worker routes/timekeeping — CLAUDE.md

**Purpose.** Time tracking — entries, the live timer, rate cards, the code and category catalogs, narrative templates, and fees. One domain module of the Worker's route tree: `index.ts` mounts every file here as one sub-app, `operations.ts` is the committed list of what it registers, and the rules below are this surface's own. The Worker-wide rules (the chokepoint, the seam, the fitness tests) are in [`../../../CLAUDE.md`](../../../CLAUDE.md); the design is [`docs/specs/2026-09-18-api-worker-domain-modules-design.md`](../../../../../docs/specs/2026-09-18-api-worker-domain-modules-design.md).

## Time entries — the two guards that read something other than the row

Two acts on `src/routes/timekeeping/time-entries.ts` decide on a fact the `time_entry` row does not carry, and
both would be silently wrong if a future change looked only at the row:

- **`POST .../{id}/unvoid` asks the AUDIT TRAIL whether the entry was converted into a cost.** That
  conversion moves the entry's value onto a cost record and voids the time in the same batch, so the
  firm cannot count the work twice; restoring the time afterwards would undo the protective half of
  the act. The link between the two records exists **only** as the `time_entry.converted_to_cost`
  audit event — no column on either row names the other — so that is what the handler reads, and the
  service takes the ANSWER (`{ convertedToCost }`) rather than the database, which is what keeps the
  rule testable without one. If a `source_time_entry_id` column ever lands on `cost_entry`, move the
  guard onto it.
- **`PATCH .../{id}` re-derives the money columns, and the inputs are three, not one.** An entry's
  amount is its billed duration times its rate. The work date re-asks the rate chain; a new
  `overrideRateE4` sets it directly; and a new `rawDurationMinutes` changes the other side of the
  product — that third one used to be missed entirely, so an entry corrected from one hour to two
  stayed billed at one. A patch touching any of the three re-rounds, re-resolves and re-multiplies;
  one touching none of them leaves every money column exactly where it stood. The re-resolution also
  carries a STANDING override forward (an entry whose `rate_source` is `override` already holds it
  in `rate_e4`), so an unrelated edit cannot quietly hand the entry back to the card's rate.

`GET .../rounding-policy` is registered **before** the `GET .../{id}` route on purpose: Hono matches
in registration order, so moving it lets the dynamic `:id` pattern claim "rounding-policy" and the
request comes back 422 for a malformed entry handle. Same rule as `quick-add-preview`.
