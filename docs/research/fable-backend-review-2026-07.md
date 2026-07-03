# Backend defects & gaps surfaced by UI work — Fable UI stream, July 2026

UI-surfaced backend observations from the UI stream's brief: the backend is read-only for this
stream, so findings are appended here for the backend stream to pick up — never fixed from the
UI side.

## Open

### No client-side error ingest endpoint (2026-07-02)

The error surfaces (`apps/web` — the route error pages with the copyable trace block) can only
offer copy-paste reporting: there is no worker endpoint that accepts a client-side error report
(unhandled promise rejection, render failure, failed fetch context) and feeds it into the
standard error pipeline ([`docs/conventions/error-logging.md`](../conventions/error-logging.md))
to mint a real Error ID. The UI currently shows "error id: not yet assigned" for client-only
failures. When the pipeline grows a client ingest route (redact-by-default applies — path and
message only, never document content), the error pages are already shaped to display the
returned Error ID, and the trace block (build commit, time, path, status, message, browser)
defines the fields the endpoint should accept.

### No aggregated versions endpoint for Settings · Versions (2026-07-02)

Settings · Versions (`apps/web/src/routes/(app)/settings/versions/+page.svelte`) shows the
current version of everything versioned in the app. Today only the app build renders real data
(baked in at build time); every backend component is an honest em-dash seam. What it needs: one
aggregated, member-readable, same-origin read returning `name` / `version` / `updated-at` for
every versioned platform component — worker/app build, the scan engine's three separable parts
(engine code, YARA ruleset, malware-definitions database), the document-editing container
(Collabora), the conversion engines, and the PDF engine.

Current state of the pieces:

- The scan container's composite `engineVersion`
  (`engine/<code>+yara-rules/<tag>+clamav-db/<db>`, `containers/scan/src/lib.rs`) already
  carries all three parts — the previously noted gap (malware-definitions DB version omitted)
  is closed at the container. But its only API exposure is
  `GET /api/v1/firm/scan-policy/score-histogram`, gated behind `firm:manageScanPolicy` — a
  policy-editing permission, the wrong gate for read-only diagnostics every member may see. The
  Versions page fetches it opportunistically and decomposes the composite; non-admins and
  engine-less environments fall through to the em-dash seam.
- `GET /api/health` reports a hardcoded `version: "0.0.0"` — not usable as a build identity.
- The editing container, conversion engines, and PDF engine report no version anywhere the SPA
  can reach.

When the endpoint ships, the page swaps its one fetch and the seam rows light up.

### No bug-report ingest endpoint (2026-07-02)

The profile menu's "Report a bug" dialog (`apps/web/src/lib/components/bug-report-dialog.svelte`)
assembles a paste-ready report (user description + build identity, time, path, browser) but can
only copy it to the clipboard. It needs a report-ingest endpoint that accepts the description
plus the trace fields, feeds the standard redact-by-default error/report pipeline
([`docs/conventions/error-logging.md`](../conventions/error-logging.md)), and mints a reference
id shown to the user. The "Request assistance" contact flow is then gated on a filed report id,
with the existing support-access framework (time-boxed, firm-approved grants) supplying the
session that follows.
