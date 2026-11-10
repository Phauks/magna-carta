# Status-page lab — research digest & mockup rationale

Working artifacts for the public service-status page (the `apps/status-worker` HTML surface,
currently a JSON placeholder). Static mockups for owner review; winners get built for real later.

## What the worker actually serves (design contract)

`GET /api/status.json` on `apps/status-worker` returns a `PublishedSnapshot`
(schema: `packages/status/src/schema.ts`):

- `overall` — one of `operational | maintenance | degraded | partial_outage | major_outage`
  (worst active component/provider status combined with active event impact).
- `components[]` — `{ id, name, group, status, note? }`. Real registry
  (`packages/status/src/component-registry.ts`): **Core** = Application API, Control-plane
  database, Object storage, Status store; **Engines** = Document editing, Document conversion,
  Search indexing, OCR, Malware scanning.
- `providers[]` — `{ id, name, status, upstreamUrl, fetchedAt, reachable }`; today only
  Cloudflare and GitHub are emitted (Helcim and Pangram are `manual` registry placeholders,
  omitted from the feed). Providers get the extra status `status_unavailable` = _their feed_
  unreachable, never counted against us.
- `events[]` — `{ title, impact (minor|major|critical|maintenance), lifecycle
  (investigating|identified|monitoring|resolved), affectedComponentIds[], startedAt,
  resolvedAt?, updates[{ at, lifecycle, body }] }`. Public audience: no author identity, ever.
  Resolved events are never pruned — the feed **is** the incident history.
- `stale` — true when the derived snapshot is older than 20 minutes (twice the 10-minute cron).

**Gaps the page must design around (as-built v1):**

- **No uptime history.** KV holds only the current snapshot; there is no per-day component
  history, so 90-day uptime bars/percentages have no data source yet. Both mockups draw the bars
  as the genre demands and label them as a seam requiring a history store (e.g. the cron
  appending a per-day worst-status record).
- **No scheduled-maintenance object.** Maintenance is expressed as an event with
  `impact: maintenance` (plus a component override); there is no `scheduledFor` field, so an
  "upcoming maintenance" section is authored-copy-only until the schema grows one.
- Engine components are always `operational` today (telemetry derivation is stubbed) — the page
  should not visually promise per-engine live measurement it does not have.
- Feed caches 30 seconds (`cache-control: max-age=30`); "refreshes" copy should match.
- Subscribe/notify does not exist yet (deferred slice) — mockups show the affordance disabled or
  as a mailto-less placeholder, not a working form.

## Genre anatomy (canonical, per Atlassian Statuspage and its imitators)

1. Verdict banner: one sentence, one color, top of page — answerable in one second.
2. Active incidents/maintenance directly under the verdict (only when live).
3. Component list: name + status word + colored indicator; groups collapsible when long.
4. Per-component 90-day uptime bars with a percentage (GitHub, Vercel, Discord).
5. Past-incident history: grouped by day, updates newest-first, timestamps in UTC, lifecycle
   labels (Investigating → Identified → Monitoring → Resolved).
6. Subscribe affordances (email/SMS/Slack/webhook/RSS) top-right.
7. Footer: fate-isolation note + link out to the infrastructure provider's own status page.

## Observations from named sites

- **GitHub** — the archetype: "All Systems Operational" heading; each component carries a
  90-day tick bar + uptime % + "90 days ago … Today" endcaps; updates reverse-chronological with
  UTC timestamps. The bars are what makes the all-green steady state feel _alive_ rather than dead.
- **Cloudflare** — buries the verdict: no single top banner, just grouped regional lists — you
  scroll to learn if anything is wrong. A cautionary example: the verdict must be first.
  Their separate "Scheduled Maintenance" section with explicit UTC windows is the right shape.
- **Vercel** — verdict first, then core services before regional nodes: order by what most
  users depend on, not alphabetically. Subscribe menu covers email/SMS/Slack/webhook/RSS.
- **Stripe** — fully custom, loads client-side (a genre mistake for a page consulted during
  outages: it should render without JS). Otherwise famous for calm typography and per-product
  rows — proof a status page can carry brand without costing legibility.
- **Discord** — pairs uptime bars with a live API-latency graph; a metric humanizes "degraded."
  (Out of scope for v1 — no latency feed — but the seam is worth remembering.)
- **Atlassian Statuspage vocabulary** (operational / degraded performance / partial outage /
  major outage / under maintenance) is exactly our component vocabulary — users already know it;
  render the familiar words, never invent synonyms.
- **Genre failure modes** to avoid: alarm fatigue (screaming red for a minor degradation),
  jargon in updates ("the DO namespace is rehydrating"), fabricated greenness (showing "checked"
  when idle — our exception-based model honestly means "no known problem", and the page should
  say so in a footnote), and burying `stale` (if the snapshot is old, say so plainly).
- **Statuspage-based pages tint the verdict banner, not the whole page** — color scoped to the
  banner + affected rows keeps an incident page readable under stress.

## The two directions mocked

- **Direction A — "The Ledger of Record"** (`status-lab/direction-a.html`): the Engraved Ledger
  register applied to the canonical anatomy — Fraunces masthead, the verdict set like a legal
  holding with an entered-at citation line, components as an engraved ledger (hairlines, small
  caps, tabular numerals), incidents as dated ledger entries that close with the accountant's
  double rule when resolved. Rationale: the status page is an outward-facing trust document —
  the register's "entered in the record" voice _is_ the credibility argument.
- **Direction B — "The Instrument Panel"** (`status-lab/direction-b.html`): quiet brand,
  maximal glanceability — a dominant full-width verdict band, dense two-column component grid
  with prominent uptime bars, incidents secondary until one is live (then pinned under the
  banner). Rationale: the genre's first duty is a one-second answer under stress; identity
  retreats to the wordmark and the paper-and-gilt palette.

Both use approximated palette values lifted from the design lab (`--paper #faf9f5`, ink text
`#22211c`, hairline `rgba(35,33,26,.13)`, gilt `#c7a857`, status hues from the open/pending/
danger trio) — approximations for review, to be replaced by design-system tokens when built.
Font stacks fall back to Georgia / system sans because the mockups are self-contained (no
external font fetch); production self-hosts Fraunces + Atkinson Hyperlegible Next.
