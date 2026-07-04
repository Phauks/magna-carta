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

### No setting change-request endpoint (2026-07-03)

Read-only firm settings pages carry a per-setting "Request a change" composer
(`apps/web/src/lib/settings/components/request-change-dialog.svelte`): a member who can see but
not edit a firm setting files a request scoped to THAT setting — the owner's direction, so both
sides share maximum context ("Matter numbering: currently X, requested Y, because Z"). Today the
composer assembles a copy-ready request; it needs an endpoint accepting `settingId`, the
member's proposed value (free text — the administrator interprets), and the reason, routed to
the members holding that setting's edit permission area. The existing access-request shape
(see-but-cannot-act yields a request, an approver acts — the support-access framework's pattern)
is the intended rail; the settings ledger then records the applied change when an administrator
acts. The requester also CHOOSES the recipients (owner direction: a request must not "go into
the void to some admin") from the members holding that setting's edit permission area, so the
payload carries explicit recipient member ids — the server validates each holds the required
permission area. The UI already scopes requests per setting, shows the current value, and
collects recipients, so the endpoint's payload should mirror exactly those fields.

### No account activity-inventory endpoint (2026-07-03)

The developer console's Resources module (and, plausibly, a future user-facing Activity
surface) wants one member-readable answer to "what is Magna Carta doing for me right now":
the account's active streams — open document-editing sessions (each is its own container),
scans and conversions in flight, queued background jobs, pending uploads. Every piece is
known somewhere server-side (editing session state, queue depth per consumer, job records);
nothing aggregates it per member/firm. The UI ships the section as an honest seam until an
endpoint exists. Server CPU/RAM is deliberately NOT requested — the Workers plane has no
per-user resource meaning, and per-container stats are platform diagnostics for operators,
not members.

### No bug-report ingest endpoint (2026-07-02)

The profile menu's "Report a bug" dialog (`apps/web/src/lib/components/bug-report-dialog.svelte`)
assembles a paste-ready report (user description + build identity, time, path, browser) but can
only copy it to the clipboard. It needs a report-ingest endpoint that accepts the description
plus the trace fields, feeds the standard redact-by-default error/report pipeline
([`docs/conventions/error-logging.md`](../conventions/error-logging.md)), and mints a reference
id shown to the user. Owner-directed additions (2026-07-03): the payload also carries optional
in-office recipient member ids ("also send to" — colleagues who should see the same report) and
an email-me-a-copy flag, so the ingest fans the filed report out to chosen firm members and, via
the platform's transactional email (which also does not exist yet), to the requester. The "Request assistance" contact flow is then gated on a filed report id,
with the existing support-access framework (time-boxed, firm-approved grants) supplying the
session that follows.
