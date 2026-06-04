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

## To build (Phase 0)

- The standard logging utility (Worker + frontend) with the allowlist/scrub boundary and correlation IDs.
- The client reporter library (error boundary, handlers, breadcrumb buffer, Error ID surfacing) and the two report surfaces.
- The bug-report Worker + the firm-scoped incident schema (D1) + screenshot handling (R2).
- The Queue wiring and the diagnostics-agent steps; the diagnostics setting.

> The hard rule — **redact by default, never log privileged content** — is a golden rule in [`CLAUDE.md`](../../CLAUDE.md).
