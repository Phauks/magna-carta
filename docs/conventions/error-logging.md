# Error & logging conventions

**Status:** Active — method decided (ADR-0038); built in Phase 0.

**Scope (single home for):** how errors and bugs are logged and surfaced — the standard logging path, redact-by-default rules, the user-facing Error ID, the in-house "send to developer" reporter, the incident pipeline, and the diagnostics agent. Standardized error & bug logging is a **golden rule** (root [`CLAUDE.md`](../../CLAUDE.md)).

**Authoritative context:** the white paper's _Observability & diagnostics_ (the design and rationale). This file is the practitioner's how-to.

## The method

- **One logging path.** Every Worker and the frontend log through the single standard utility — never ad-hoc `console.log` of domain data. **Redact by default:** events are assembled from an allowlist; a scrubbing pass at the boundary is the backstop. A **correlation ID** rides every request.
- **Error ID.** Every error surfaces a short, user-visible **Error ID** that maps to the server-side trace. Operational traces are always captured (Workers Logs/Logpush → R2 / Analytics Engine); they are monitoring, not an incident.
- **In-house client reporter.** A Svelte error boundary + global `onerror`/`unhandledrejection` handlers + a **breadcrumb ring buffer** (actions/IDs, never field content). **No third-party error SaaS** — privileged stacks/context never egress.
- **Two report surfaces.** "Send to developer" on the crash screen; an always-available "Report a problem" in the help menu.
- **Incident (user-initiated only).** On send: Error ID(s) + redacted breadcrumbs + user description + opt-in/redactable screenshot + context metadata → bug-report Worker → **firm-scoped D1** incident (+ R2 screenshot). Description/screenshot are **access-gated and audited**.
- **Diagnostics agent (propose-only).** Triage → root-cause draft → **draft PR** (money/trust/conflicts always human-reviewed) → acknowledge the reporter.
- **Diagnostics setting.** Per firm, per-user override: **Off/strict** (default) · **Standard** (breadcrumbs attached) · **Verbose/auto** (standing-consent auto-submit — the beta posture).

## Built / to build

Slice 0·6 (2026-06-13) built the **backend** of this standard; the **UI** surfaces are inherited by the design-system/auth-UI slice (0·7a/0·7b), which has something to attach them to.

- **[built — 0·6]** The standard logging path: `@magna-carta/telemetry` — allowlist event builders (redaction structural: an undeclared field has no slot to be logged in), the scrubbing-backstop tripwire, `cor_` correlation + `err_` Error IDs, the pure `Logger` seam + the Workers adapter (the one `console.*` site) emitting structured JSON to Workers Logs + counters to Analytics Engine. The telemetry middleware mints correlation per request and the `app.onError` boundary turns any escaped exception into the RFC 9457 500 carrying its Error ID. Enforced by the **console-ban** + **errorId-coverage** fitness functions.
- **[built — 0·6]** The bug-report Worker realized as **`POST /v1/incidents`** in the single Worker (ADR-0069), writing the firm-scoped `incident` row + an `incident.created` outbox→Queue message (no consumer yet — the diagnostics agent's future feed). The `screenshot_key` is schema'd; capture/upload arrives with the UI surfaces.
- **[→ 0·7a/0·7b]** The client reporter library (Svelte error boundary, `onerror`/`unhandledrejection` handlers, breadcrumb ring buffer, Error ID surfacing) and the two report surfaces (crash screen, "Report a problem"); screenshot capture/redaction; the diagnostics-level setting UI; visual-regression CI.
- **[→ later]** The **diagnostics agent** steps (triage → root-cause → draft PR → acknowledge), once incidents actually flow — the `incident.created` Queue message is its contract.
- **[seam]** Incident `description` is firm-boundary plaintext today; it moves under `protected()` (access-gated, audited reads) when the crypto module lands (slice 1·2).

> The hard rule — **redact by default, never log privileged content** — is a golden rule in [`CLAUDE.md`](../../CLAUDE.md).
