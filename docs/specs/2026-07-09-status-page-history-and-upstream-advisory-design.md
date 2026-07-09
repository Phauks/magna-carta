# Status page — 90-day history and the upstream advisory

**Date:** 2026-07-09
**Status:** accepted, in build
**Supersedes nothing.** Extends [`2026-07-02-service-status-design.md`](2026-07-02-service-status-design.md).

## Problem

Two defects in the shipped public status page.

**An upstream provider sets our verdict.** `mergeSnapshot` folds provider statuses into the overall
rollup. When Cloudflare publishes "degraded performance on some services", `status.magnacarta.esq`
announces _"Degraded performance on some services"_ about **us**, with no probe of ours failing. The
page's job is to answer "is Magna Carta out of service?" — a provider's own status is context, not an
answer.

**There is no history.** The page shows only the present moment plus an unbounded list of resolved
events. Every status page in the genre shows a per-component uptime record; a reader who arrives after
an incident has no way to see whether the platform is normally reliable. The renderer already carries a
comment marking the uptime bar as a seam awaiting a history store.

## Decisions

1. **Upstream provider status never sets the platform verdict.** `overall` is derived from our own
   components and our own active events, and from nothing else. Recorded as an ADR.
2. **An upstream advisory is a distinct surface**, not a severity. It sits between the verdict band and
   the component groups, in neutral ink outside the warn/danger family, and states plainly whose status
   it is reporting.
3. **Uptime is sample-counted, not day-summarized.** The 10-minute cron increments a per-component,
   per-day tally of statuses. A missed cron is an uncounted sample, never a green one.
4. **Maintenance is excluded from uptime** — dropped from numerator and denominator — while still
   coloring its day tick in the calm blue maintenance hue.
5. **History lives in a third KV key**, `status:history`, written only by the cron. No new binding, so
   the status worker's fate-isolation invariant holds unchanged.
6. **The incident archive spans the same 90 days** as the bars, listing only days that had a resolved
   event and closing with a single line accounting for the incident-free remainder.

## The shared effective status

An operator can declare a service event against `search` without also setting a component override. The
component row and the uptime tick would both stay green while the page's own banner announced an
outage. That is precisely the false greenness this page exists to avoid.

One pure function resolves it, used by both the merge and the history append:

```
effectiveComponentStatus(derivedStatus, override, activeEventsAffectingThisComponent)
  = worst(derivedStatus, override?.status, ...events.map(impactAsStatus))
```

The consequence is intended: declaring an event now colors the affected component's row, where
previously it moved only the overall verdict. An override still wins on note text.

## The history store

`status:history`, its own `HISTORY_SCHEMA_VERSION` independent of `SCHEMA_VERSION`:

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-07-09T12:00:00.000Z",
  "days": {
    "2026-07-09": {
      "api": { "operational": 144 },
      "engine-conversion": { "operational": 138, "degraded": 6 }
    }
  }
}
```

Roughly 90 days x 8 components x a few counters — a few tens of kilobytes, far inside KV's value limit.
The cron is the only writer and runs every ten minutes, so the read-modify-write needs no coordination.

`packages/status/src/history.ts` holds the pure functions, mirroring how `derive.ts` and `merge.ts` are
already testable outside a Worker:

- `appendSample(history, statuses, now)` — increments today's counters, prunes days outside the window.
- `summarizeHistory(history, componentIds, now)` — per component, 90 ticks (`ComponentStatus | null`,
  where `null` means _no data_) and a `uptimeRatio` of `operational / (samples - maintenance)`, or
  `null` when nothing countable was recorded.

A day's tick color is the worst status with a nonzero count that day.

## The published snapshot

Two additive fields. No `SCHEMA_VERSION` bump: the stored `derived` and `authored` documents are
unchanged in shape, and bumping would fail-parse the live documents and blank the page for a cron cycle.

```ts
upstreamAdvisory: { providers: {...}[]; worst: ProviderStatus } | null
history: { windowDays: number; components: Record<string, { ticks: (ComponentStatus | null)[]; uptimeRatio: number | null }> }
```

`upstreamAdvisory` is populated from providers whose status is neither `operational` nor
`status_unavailable`. An unreachable provider feed remains honest uncertainty about them and raises no
advisory — it is already footnoted in the providers section.

## Rendering

The advisory band renders after the verdict and stale strip, before the component groups: a neutral
surface, the provider's own severity dot, the provider name linking to their status page, and copy
naming whose status it is. It never adopts the verdict's hue.

The uptime bar fills the seam in `renderComponentRow`: ninety `<span>` ticks, no JavaScript. The bar
carries `role="img"` and an `aria-label` reading "Core services: 99.2% uptime over the last 90 days";
individual ticks are `aria-hidden` with a `title` giving date and status. A component with no countable
samples reads "No data", never "100%". Roughly 720 spans across eight components — about 30 KB of HTML,
acceptable on a page that must render without script.

`renderHistory` becomes "Past service events — last 90 days", listing only days with a resolved event
and closing with "No incidents reported on the other N days."

## Failure behavior

A corrupt or absent `status:history` parses to an empty document, exactly as the other two keys do; the
bars render as all-no-data rather than throwing. The status worker's never-`5xx` rule is untouched, and
its single-binding invariant is unchanged.

## Tests

- `merge.test.ts` — a degraded provider leaves `overall: "operational"` and populates `upstreamAdvisory`;
  `status_unavailable` raises no advisory; an active event colors its affected component's row.
- `history.test.ts` — append, prune at the window edge, maintenance excluded from the ratio, a missed
  cron does not inflate uptime, `uptimeRatio: null` on no data, worst-status tick coloring.
- `apps/worker` (Miniflare) — the cron writes `status:history` and folds authored overrides into it.
- `render-status-page.test.ts` — the advisory band appears only when warranted, bars render with honest
  labels, the archive states the incident-free-day count, and the page needs no script to be read.
