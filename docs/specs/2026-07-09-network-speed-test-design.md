# Network Speed Test — tool page (design)

**Date:** 2026-07-09 · **Stream:** `slice-0-7b-app-shell` · **Status:** approved, building

## Purpose

Give the Network Speed Test tool its page: a benchmark of the firm's connection with
the same measurements a user would get from `speed.cloudflare.com` — download, upload,
latency (idle and under load), jitter, and Cloudflare's network-quality (AIM) scores —
plus one thing that site cannot answer: _is the slowness the internet, or is it us?_

This is the **first per-tool page**, so it also establishes the composition every later
tool copies: the masthead with the standing "Runs outside any matter" line, a run
surface, results in the ledger voice, and no persistence.

## Decisions

1. **Engine: `@cloudflare/speedtest`.** The measurement engine that powers
   `speed.cloudflare.com`. Version 1.11, MIT, zero runtime dependencies, pure
   JavaScript — no C/C++ anywhere, so golden rule 14 needs no consent. This
   confirms the recommendation already recorded in the Tools-area design: build on
   the official client library, never an iframe of `speed.cloudflare.com` (an
   external iframe cannot be design-system-styled).
2. **Cloudflare's default measurement ladder, unmodified.** The scaling runs (100 KB →
   250 MB down, 100 KB → 50 MB up) are what make our numbers comparable to theirs. We
   do not invent a lighter ladder; a benchmark that is not comparable is not a benchmark.
3. **No autostart — an explicit Start, behind two disclosures.** `speed.cloudflare.com`
   itself states "a speed test can consume up to 200MB of data" and "your IP address
   will be shared with Cloudflare". Spending 200 MB of a firm's connection the instant
   a nav link is clicked is hostile on a metered or tethered line. We show both facts
   and wait for Start. After a run, Start becomes **Retest** (`restart()`); **Pause** and
   **Resume** mirror the engine's own controls.
4. **Packet loss is stated as unavailable, not faked.** Measuring it requires a WebRTC
   TURN server, and Cloudflare's public one is deprecated and being discontinued.
   Standing up a TURN credential service is out of scope here. The Packet Loss panel
   says exactly that, in plain language. It is not a blank, a zero, or a dash.
5. **One new Worker route: `connection`.** Returns what the edge sees about the caller
   — public IP, AS number and organization, the Cloudflare colo that served them, and
   country — and doubles as the round-trip probe target that answers "is it us or is it
   you?". Deliberately **not** `/api/health`: that route does a control-plane D1
   `SELECT 1`, so it measures database latency, not network latency, and hammering it
   would pollute the liveness signal.
6. **Nothing is persisted.** No run history, no results stored, no matter attachment.
   The Tools area is ethereal by design, and a speed test is the purest case of it.
7. **Charts are token-styled SVG, local to this tool.** Every series here is
   single-series (bandwidth buckets; and the three latency phases render as small
   multiples, as Cloudflare renders them), so there is no categorical palette and no
   colorblind-separation problem to solve. Adopting a charting library is a real
   decision with real consumers — Reports and the dashboard — and it will be made
   against their requirements, in its own ADR, not against a speed test's.
8. **Launchability is corrected (see below).** This slice fixes a defect in the Tools
   listing page.

## The launchable-rule correction (a fix, not a feature)

`tool-tile.svelte` and `tool-row.svelte` currently compute
`launchable = presentation.stage === "ready"`. That conflates two different things.

The maturity system measures **how finished** a surface is, not **whether it exists**:
`navigation/destinations.ts` ships `Settings` as `shipped: true, stage: "alpha"`, and it
is a live link that wears an "Alpha" badge. Under the tools rule as written, a working
tool at `alpha` or `beta` would render **inert and unreachable** — its own page existing
but never linked.

**The correction belongs in the maturity module, not in the components.** `maturity.ts`
declares itself the one home for the stage model ("TO ADD A STAGE: add it to
`MaturityStage` and give it one row in `MATURITY_PRESENTATION`. Every consumer picks it up
with no further change."). Whether a stage implies a reachable surface is a fact about the
stage, so it lives beside the stage — not string-compared in two components that would
then drift.

Add to `apps/web/src/lib/maturity/maturity.ts`:

```ts
/**
 * `soon` is the one stage that means no surface exists yet. Every other stage has a
 * surface and is reachable; its badge states how finished that surface is. The sidebar
 * already relies on this distinction — Settings is `alpha` and is a live link.
 */
export function hasSurface(stage: MaturityStage): boolean {
  return stage !== "soon";
}
```

`tool-tile.svelte` and `tool-row.svelte` then read
`const launchable = $derived(hasSurface(presentation.stage));`, and a new stage added to
the model is classified in exactly one place.

`ready` continues to wear no badge (`MATURITY_PRESENTATION.ready` is `null`).
`alpha`/`beta` are launchable **and** badged. The Network Speed Test ships at **`alpha`**:
`alpha` means just built, with a long road ahead, and that is where a newly built surface lands
however complete it looks. `beta` means closing in. Promotion between stages is the owner's call,
never the implementer's.

Its descriptor is also corrected — the tool benchmarks the connection generally, not
only the path to us:

> Measure this connection's download, upload, latency, and quality.

## Route & files

Frontend, under `apps/web/`:

| File                                                     | Role                                                   |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `src/routes/(app)/tools/network-speed-test/+page.svelte` | The tool page — masthead, run surface, results         |
| `src/lib/tools/speed-test/speed-test-engine.svelte.ts`   | Rune store wrapping the engine's lifecycle + results   |
| `src/lib/tools/speed-test/speed-test-format.ts`          | Pure formatting (bps → Mbps, ms, ratios) — unit-tested |
| `src/lib/tools/speed-test/connection-probe.ts`           | Fetches the connection route; N samples → median RTT   |
| `src/lib/tools/speed-test/metric-tile.svelte`            | One headline metric (label, value, unit)               |
| `src/lib/tools/speed-test/bandwidth-chart.svelte`        | Single-series bar chart over the scaling buckets       |
| `src/lib/tools/speed-test/latency-chart.svelte`          | Single-series point chart (one latency phase)          |
| `src/lib/maturity/maturity.ts`                           | `hasSurface(stage)` — the one home for the rule        |
| `src/lib/tools/tool-tile.svelte`, `tool-row.svelte`      | Consume `hasSurface`, replacing the `=== "ready"` test |
| `src/lib/tools/tool-presentation.ts`                     | `network-speed-test` → stage `alpha`, new descriptor   |

Backend, under `apps/worker/`:

| File                                   | Role                                            |
| -------------------------------------- | ----------------------------------------------- |
| `src/routes/tools/tools-connection.ts` | The connection route (pattern: `firm-usage.ts`) |
| `src/app.ts`                           | One registration line                           |

**Contract obligations.** A new route changes the emitted OpenAPI document, so
`apps/worker/test/contracts/openapi-snapshot.test.ts` must be updated and the typed API
client regenerated (`pnpm run generate-client`). Both are part of the change, not follow-up.

## The connection route

```
GET /api/v1/tools/connection
```

Route metadata follows `firm-usage.ts`: `surface: "app"`, `authenticated: true`,
`permission: "tools:speedTest"`, `resource: "firm"`, `audited: false`. It rides the
chokepoint like every other route — nothing reachable skips that seam.

Response body:

```ts
{
  ip: string; // CF-Connecting-IP — the caller's own public address
  asn: number; // request.cf.asn
  asOrganization: string; // request.cf.asOrganization — the ISP's name
  colo: string; // request.cf.colo — the Cloudflare edge that served this request
  country: string; // request.cf.country
}
```

The handler reads only `request.cf` and the connecting-IP header. It touches no database
and does no work, so its response time is network round-trip plus edge dispatch — which
is exactly the quantity the probe wants to measure.

**Privacy.** The route returns the caller's own connection facts to the caller. It is
`audited: false` and **the IP is never logged** — the standard error/telemetry pipeline
redacts by default, and nothing here opts in.

**Rate limit.** The probe takes a small fixed number of samples (5) and reports the
median, so the route stays inside an ordinary rate-limit bucket. The sample count is a
constant in `connection-probe.ts`, not a knob.

## Page composition (the template every later tool copies)

Canvas voice throughout; theming stays at the edges.

- **Masthead.** "Network Speed Test", with the standing line _"Runs outside any matter."_
- **Run surface.** Before the first run: the two disclosures (up to ~200 MB of data;
  your IP address is shared with Cloudflare) and a **Start** button. During a run: a
  progress indication of the current phase, plus **Pause**. After: **Retest**.
- **Headline metrics.** Download, Upload, Latency, Jitter, Packet Loss — as metric
  tiles. Packet Loss reads "Unavailable" with a one-line explanation.
- **Network Quality Score.** The engine's AIM scores, rendered as a short list of
  use-cases (video streaming, online gaming, video calls) with the classification word
  the engine returns. The exact shape is read from the shipped
  `node_modules/@cloudflare/speedtest/dist/speedtest.d.ts` at build time — never guessed.
- **Your connection.** Public IP, ISP (AS organization), the Cloudflare edge (colo)
  serving this session, and the median round-trip to Magna Carta. This is the panel that
  answers "is it us or is it you": a healthy RTT here beside poor bandwidth means the
  problem is not the platform.
- **Latency measurements.** Three small multiples — idle, during download, during upload
  — each a single-series point chart with its own median stated.
- **Bandwidth measurements.** Download and upload, each a single-series bar chart across
  the engine's scaling buckets.

## Charts — the rules they follow

Single series throughout, so: no legend (the title names the series), no categorical
palette, no cycled hues. Recessive grid and axes; thin marks; 4px rounded data-ends
anchored to the baseline; ≥8px markers; text wears text tokens, never the series color.
Each chart carries a hover tooltip, and each measurement panel offers a table view so
identity and value are never conveyed by position or color alone. Dark mode is chosen
against the dark surface, not an automatic flip. Motion is limited to opacity/transform
and respects `prefers-reduced-motion`.

## Error handling

- **Engine error** (`onError`): the run stops and the page states what failed and offers
  Retest. Results already measured stay on screen — a partial answer is still an answer.
- **Blocked endpoints.** A firm firewall that blocks `speed.cloudflare.com` will fail the
  run. That is itself diagnostic: the page says the measurement endpoints were
  unreachable and suggests the network is filtering them, rather than reporting 0 Mbps.
- **Connection route failures** (401/403/429/network): the "Your connection" panel states
  it could not reach Magna Carta and the rest of the run proceeds. The two halves fail
  independently — that independence is the whole point of the panel.
- **Navigating away mid-run** aborts the engine (the store's cleanup calls `pause()`), so
  a background tab never keeps consuming the firm's bandwidth.

## Testing

- **Pure formatting** (`speed-test-format.ts`): bps → Mbps rounding and unit selection,
  millisecond formatting, ratio → percentage. Node-pool unit tests under `apps/web/test/`.
- **Probe math** (`connection-probe.ts`): median of an odd/even sample set; a failed
  sample is excluded, not counted as zero; total failure returns "unreachable".
- **`hasSurface(stage)`** (pure, in the maturity module): `soon` → false; `alpha`, `beta`,
  `ready` → true. Asserted over every member of `MaturityStage`, so a stage added later
  cannot be silently unclassified. This is the regression the correction exists to prevent.
- **Worker route**: returns the `cf` facts; enforces `tools:speedTest` (403 without it);
  401 unauthenticated. OpenAPI snapshot updated; generated client rebuilt.
- **Browser verification**: Start runs a real measurement to completion; metrics populate;
  Packet Loss states unavailable; the connection panel resolves; Retest re-runs; charts
  render in light and dark; navigating away stops the run.

## Definition of done (golden rule 5)

Shipped with the code, in the same change: a `changelog.d/` fragment, the
`status.d/tools-area.md` fragment updated, and the UI-roadmap Stage 3 line narrowed
(the speed test leaves the "first tool widgets" list). A `docs/user/` page **is**
warranted here — unlike the listing page, this tool does something a user performs — so
a short user guide ships too: what the test measures, that it uses data, and how to read
the result.

## Coordination

This branch's active-work note records "backend is read-only for this stream (UI brief)".
This slice adds one additive, read-only Worker route and touches no schema, no
data-access layer, and no existing handler. The note is amended in the same change to
record the exception rather than leave it contradicted.

## Out of scope (named, not forgotten)

Packet loss and the TURN credential service · a charting library and its ADR (deferred to
Reports, its real consumer) · persisting or exporting results · scheduling recurring tests
· per-firm history or benchmarking against other firms · the remaining tool pages.
