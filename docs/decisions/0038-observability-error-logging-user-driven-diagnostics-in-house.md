---
number: 38
slug: observability-error-logging-user-driven-diagnostics-in-house
status: Accepted
date:
area: Observability
---

**Error logging & user-driven diagnostics — in-house, Cloudflare-native.** Two layers: **operational telemetry** always-on (redacted, Error-ID-keyed traces) vs. developer-visible **incidents** that are **user-initiated only**. An **in-house client reporter** (Svelte error boundary + global handlers + breadcrumb ring buffer — actions/IDs, never content) surfaces a short **Error ID** with a one-click **"Send to developer"** on crashes and an always-available **"Report a problem."** A report = Error ID(s) + redacted breadcrumbs + user description + **opt-in/redactable screenshot** + context → bug-report Worker → **firm-scoped D1 incident** (+ R2 screenshot), access-gated + audited. The **diagnostics agent** acts on submitted reports, **propose-only**: triage → root-cause draft → **draft PR** (money/trust/conflicts human-reviewed) → acknowledge the reporter. A **diagnostics setting** (per firm, per-user override) selects Off/strict (default) · Standard · Verbose/auto, where verbose/auto is the standing-consent **beta** posture — one setting, one pipeline. **No third-party error SaaS** (privileged stacks never egress — same logic as in-house file conversion); **self-hosted Sentry deferred**. Rejected: third-party error SaaS (Sentry SaaS/Highlight) and auto-capture-everything (surveillant, against the user-initiated stance).
