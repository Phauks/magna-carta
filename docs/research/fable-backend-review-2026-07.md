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
