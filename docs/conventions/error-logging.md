# Error & logging conventions

**Status:** Active — method decided (ADR-0038); built in Phase 0.

**Scope (single home for):** how errors and bugs are logged and surfaced — the standard logging path, redact-by-default rules, the user-facing Error ID, the in-house "send to developer" reporter, the incident pipeline, and the diagnostics agent. Standardized error & bug logging is a **golden rule** (root [`CLAUDE.md`](../../CLAUDE.md)).

**Authoritative context:** the white paper's _Observability & diagnostics_ (the design and rationale). This file is the practitioner's how-to.

## The method

- **One logging path.** Every Worker and the frontend log through the single standard utility — never ad-hoc `console.log` of domain data. **Redact by default:** events are assembled from an allowlist; a scrubbing pass at the boundary is the backstop. A **correlation ID** rides every request.
- **Both emission paths are allowlisted — events and counters.** An event declares its loggable fields, and a declared field carries only a flat primitive (a structure has no way through). A counter declares its metric name and its **ordered dimension keys**, which are the Analytics Engine column contract; an undeclared metric or dimension is dropped, and dimension values are scrubbed like any other string. Counter dimensions are enum-like labels, never identifiers or free text. Both catalogs live in `@magna-carta/telemetry` and both are enforced by fitness functions.
- **Error ID.** Every error surfaces a short, user-visible **Error ID** that maps to the server-side trace. Operational traces are always captured (Workers Logs/Logpush → R2 / Analytics Engine); they are monitoring, not an incident.
- **An Error ID says when it was minted and which Worker minted it.** The body is `<9 base36 ms since epoch><3-character service code><9 base62 random>` — `describeErrorId` in `@magna-carta/telemetry/ids` reads it back. Both facts are on the log record too, and being on the record is no help while the record is the thing being searched for: a member quotes an id days later, and whoever reads it has to pick a Worker and judge whether the retention window still holds it before the search can even start. The fields are packed **into** the existing 21-character body rather than appended to it, because that body's shape is pinned by the identifier validators, by the `pattern` emitted for every identifier field in the OpenAPI document, and by the scrubber's whole-handle exemption — an Error ID the scrubber stops recognising is one the pipeline rewrites to `[scrubbed]` on the way out. A Worker announces itself once through `setServiceIdentity`; one that never does mints `unk`, which is legible rather than wrong.
- **One failure, one Error ID.** `logOperationFailed` returns the id it minted, and a caller that must show the member an id uses that return value. Minting one for the member and letting the logger mint another leaves the record's `errorId` naming a failure nobody holds, so a support search against the field — the one thing the field exists for — finds nothing.
- **In-house client reporter.** A Svelte render boundary in the root layout (a throw while a route renders becomes the failure screen with a client-minted Error ID; SvelteKit alone leaves such a throw in the console) + the SvelteKit `handleError` hook for load failures + global `onerror`/`unhandledrejection` handlers + a **breadcrumb ring buffer** (actions/IDs, never field content). **No third-party error SaaS** — privileged stacks/context never egress.
- **Two report surfaces.** "Send to developer" on the crash screen; an always-available "Report a problem" in the help menu.
- **Incident (user-initiated only).** On send: Error ID(s) + redacted breadcrumbs + user description + opt-in/redactable screenshot + context metadata → bug-report Worker → **firm-scoped D1** incident (+ R2 screenshot). Description/screenshot are **access-gated and audited**.
- **Diagnostics agent (propose-only).** Triage → root-cause draft → **draft PR** (money/trust/conflicts always human-reviewed) → acknowledge the reporter.
- **Diagnostics setting.** Per firm, per-user override: **Off/strict** (default) · **Standard** (breadcrumbs attached) · **Verbose/auto** (standing-consent auto-submit — the beta posture).

## The client half

**One record, one vocabulary, three sizes.** A failed call resolves to one of three outcomes — the
value, a problem document, or nothing answering at all — and both failing ones carry a `Failure`:
the problem (or its absence), the request line, and the instant it failed. Every surface renders
from that record and never flattens it to a sentence at the catch site. Home:
[`apps/web/src/lib/api/problem.ts`](../../apps/web/src/lib/api/problem.ts) for the model,
[`apps/web/src/lib/diagnostics/`](../../apps/web/src/lib/diagnostics/) for the presenter, the trace,
the breadcrumb ring and the reporter, and the design system's `failure-state` / `failure-band` /
`failure-details` for the rendering.

- **The presenter is a floor, never a ceiling.** `guidance.ts` maps a problem to a tone, a heading, a
  sentence and a remedy, so nothing ever renders blank; a surface overrides the wording wherever its
  channel fails distinctly, which the per-channel ruling in
  [`design-corrections.md`](design-corrections.md) requires. The server's own `detail` outranks both.
- **The remedy comes from what the server said**, not from what the surface guesses. `stepUpRequired`
  and `requestAccess` are ways THROUGH and outrank a retry; `retryAfterSeconds` drives a counting
  control; a refusal that would refuse identically grows no control at all.
- **A 404 is two failures wearing one status.** One carrying a registered `type` and an `errorId` is a
  record that is genuinely gone. One carrying neither was answered by no route at all — the app only
  calls paths it was built against — which means the interface and the API are on different releases.
  Getting this backwards blames a member for a deploy, or tells them to wait for a release that will
  not bring their record back. `isServiceSkew` is the discriminator; both directions are pinned by
  test.
- **The trace is built so one paste is enough**, and states what it does not have: "error id: (none
  issued)" is a finding, where a missing line is indistinguishable from a truncated paste. The
  assembly is pure and lives apart from the environment read, because a module that reads the build
  identity cannot be imported by a plain unit test.
- **Copy never claims a success it did not have.** The async clipboard is refused on an insecure
  origin, when the document is not focused, and by some managed policies; the control falls back to a
  selection copy and, failing that, says so and leaves the text selectable.
- **Breadcrumbs are shapes, not values** — a route, a request line, a control name. There is no slot
  for a payload, labels are capped at what the incident route accepts, and anything shaped like an
  email address is replaced before it is stored.
- **Nothing files itself.** A crash mints a handle and offers the report. The standing-consent tier
  is a setting a firm turns on, not a behaviour that arrives with a boundary.

Enforced by **`pnpm run lint:failure-surface`**: a problem flattened to a sentence at the catch site,
or an Error ID smuggled into a message string, fails the build.

## Built / to build

Slice 0·6 (2026-06-13) built the **backend** of this standard. The **UI** surfaces landed with the
unified failure surface (design:
[`../specs/2026-08-31-unified-error-surface-design.md`](../specs/2026-08-31-unified-error-surface-design.md)).

- **[built — 0·6]** The standard logging path: `@magna-carta/telemetry` — allowlist event builders (redaction structural: an undeclared field has no slot to be logged in), the scrubbing-backstop tripwire, `correlation_` + `error_` handles, the pure `Logger` seam + the Workers adapter (the one `console.*` site) emitting structured JSON to Workers Logs + counters to Analytics Engine. The telemetry middleware mints correlation per request and the `app.onError` boundary turns any escaped exception into the RFC 9457 500 carrying its Error ID. Enforced by the **console-ban** + **errorId-coverage** fitness functions.
- **[built — 0·6]** The bug-report Worker realized as **`POST /v1/incidents`** in the single Worker (ADR-0069), writing the firm-scoped `incident` row + an `incident.created` outbox→Queue message (no consumer yet — the diagnostics agent's future feed). The `screenshot_key` is schema'd; capture/upload arrives with the UI surfaces.
- **[built]** The client reporter library — the SvelteKit client boundary in `apps/web/src/hooks.client.ts`
  (which mints a `client_` handle for a failure the platform never saw), the `onerror` /
  `unhandledrejection` handlers, the breadcrumb ring buffer, and Error ID surfacing on every failure
  surface. Both report surfaces are live: the crash screen's, and the always-available one in the
  profile menu and command palette, which files through `POST /v1/incidents` rather than producing
  text for a person to paste.
- **[→ later]** Screenshot capture/redaction (the `screenshot_key` column is schema'd and the
  affordance renders Soon); the diagnostics-level setting UI; visual-regression CI over the failure
  states — the dev-only gallery at `/developer-console/failure-states` is the review surface it would
  photograph.
- **[→ later]** The **diagnostics agent** steps (triage → root-cause → draft PR → acknowledge), once incidents actually flow — the `incident.created` Queue message is its contract.
- **[seam]** Incident `description` is firm-boundary plaintext today; it moves under `protected()` (access-gated, audited reads) when the crypto module lands (slice 1·2).

> The hard rule — **redact by default, never log privileged content** — is a golden rule in [`CLAUDE.md`](../../CLAUDE.md).
