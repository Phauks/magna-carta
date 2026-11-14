// The POST routes that mutate nothing, and why each one is allowed to.
//
// Two fitness functions ask the same question of the same contract and had their own copies of the
// answer: conformance.test.ts reads the document the route table emits, auth-provisioning-e2e.test.ts
// reads the one the running worker serves. The copies drifted — `uploads.matches` reached one of them
// and not the other, and the suite was red on main until somebody noticed. One home, so a route that
// earns an exemption earns it once.
//
// A POST here is exempt from the audited-mutating requirement: there is no state change to audit,
// and auditing a hot read-shaped POST (the numbering live preview, fired on every keystroke) would
// flood audit_log. Each
// is allow-listed by operationId with its justification, the same explicit-exemption pattern as
// PUBLIC_ALLOW_LIST. The non-null-permission requirement still binds (these are authenticated).
export const NON_MUTATING_POST_ALLOW_LIST: Record<string, string> = {
  "numbering.preview":
    "Pure render of a candidate numbering scheme against a sample context — no write, no counter touch.",
  "directory.duplicateCandidates":
    "Read-shaped POST: unions the phonetic/trigram/blind-index blocking channels for a consultation entity (match facts ride the body) — no write, no decrypt.",
  "shipping.rateShipment":
    "Live rate-shop read-through to the carrier — POSTs the package to fetch ephemeral rates, persists nothing.",
  "shipping.tracking":
    "Pulls current carrier tracking and caches events (INSERT OR IGNORE dedup) — a read-shaped sync, not an auditable business mutation.",
  "customFields.previewConvert":
    "Read-shaped POST: counts how each current value would land under a kind change (the target kind rides the body) — no write, no audit.",
  "timeEntries.previewQuickAdd":
    "Read-shaped POST: parses a one-line quick-add string and returns matter candidates — no write, nothing committed.",
  "emails.suggestMatters":
    "Read-shaped POST: ranks the matters an open message might belong to (the message facts ride the body rather than a URL) — no write, nothing filed.",
  "conversions.upload":
    "Pure credential mint: mints a jobId and a short-TTL presigned PUT URL — no D1 write, no firm state change, just a signed URL the client uploads to directly.",
  "templates.upload":
    "Pure credential mint: mints a staging key and a short-TTL presigned PUT URL for a template document — no D1 write, no firm state change, just a signed URL the client uploads to directly (the conversions.upload precedent).",
  "conversions.submit":
    "Enqueues a conversion job through a Durable Object (no D1 write, no firm-database row): the DO + queue track the lifecycle; there is no audit_log row class that models a transient compute job.",
  "safeBrowse.post":
    "Renders a suspect URL in an isolated remote browser and returns a static snapshot — a pure read over the request body, no firm-data write; the target URL is deliberately never logged (redaction).",
  "safeBrowse.stream":
    "The streaming twin of safeBrowse.post — the same pure read delivered as newline-delimited stage lines; nothing is written and the target URL is deliberately never logged (redaction).",
  "calendarSync.receiveGoogleNotice":
    "As calendarSync.receiveMicrosoftNotice: a provider's notice that a member's calendar changed, which writes no firm data and only brings that account's ordinary sync pass forward.",
  "calendarSync.receiveMicrosoftNotice":
    "A calendar provider's notice that a member's calendar changed. It writes no firm data and no row: a notice carrying the account's secret only brings that account's ordinary sync pass forward, and what the pass then changes is audited where it is changed. Auditing each notice would write a row per calendar edit per member, most of them echoes of this platform's own writes.",
  "metadata.inspect":
    "Pure computation over the uploaded bytes — reports metadata findings; nothing is stored, no firm data is written.",
  "metadata.scrub":
    "Pure computation over the uploaded bytes — returns a cleaned copy in-process; nothing is stored, no firm data is written.",
  "fileIntegrity.hash":
    "Pure computation over the streamed request body — computes five digests in one pass; nothing is stored, no firm data is written.",
  "fileType.verify":
    "Pure classification over the uploaded bytes — identifies the true content type (raw facts from the container, verdict app-side); nothing is stored, no firm data is written.",
  "fileRepair.diagnose":
    "Pure diagnosis over the uploaded bytes — reports detected format, corruption, and recoverability; nothing is stored, no firm data is written. The persisting attach variants are separate audited routes.",
  "fileRepair.repair":
    "Pure reconstruction over the uploaded bytes — returns the repaired copy in-process; nothing is stored, no firm data is written. The persisting attach variant is a separate audited route.",
  "fileRepair.carve":
    "Pure carving over the uploaded bytes — returns recovered embedded files in-process; nothing is stored, no firm data is written. The persisting attach variant is a separate audited route.",
  "ocr.recognize":
    "Pure recognition over the uploaded bytes — returns per-page text, word boxes, and confidence; nothing is stored, no firm data is written.",
  "ocr.searchable":
    "Pure recognition over the uploaded PDF — returns the same document with an invisible searchable text layer; nothing is stored, no firm data is written.",
  "emailInspector.inspect":
    "Pure computation over the uploaded message bytes — parses and returns the structural inspection; nothing is stored, no firm data is written.",
  "communications.callerLookup":
    "Read-shaped POST: what is known about a typed telephone number at no cost (the Directory records that list it, its area code's region, a caller ID already kept). The number is a client's, so it rides the body rather than a logged URL; nothing is written and nothing is paid for. The paid lookup is the separate, audited communications.callerIdentity.",
  "addressLookup.suggest":
    "Read-shaped POST: asks the address service for addresses matching what has been typed (the typed text is a client's address, so it rides the body rather than a logged URL) — no write, nothing kept.",
  "addressLookup.resolve":
    "Read-shaped POST: turns a chosen address offer into its parts, or a building into its units — no write; the caller's form stores the result through its own audited route.",
  "aiDetection.detect":
    "Analysis POST: sends pasted text to the platform-managed detector and returns a likelihood band. The only write is one incidental ai_detection_usage meter row (telemetry — the accountability record for the egress), not an auditable firm-domain mutation; auditing every detection would flood audit_log.",
  "trust.previewStatementImport":
    "Read-shaped POST: parses a bank-statement file the firm supplied and reports what is in it — the column mapping, every readable row and what it would become, every unreadable row and why. Nothing is stored; storing takes the separate, audited import route quoting this report's fingerprint back.",
  "reports.exportRender":
    "A printer, not a data source: pure composition of the tabular document the caller already holds into a Word or PDF file, returned as bytes. Nothing is stored; filing a produced export would be a separate route riding reports:produce.",
  "uploads.matches":
    "Read-shaped POST: answers whether the firm already holds a file's bytes, by the SHA-256 and size in the body, before they are uploaded. Nothing is stored; a POST only because the digest and size are a question, not a resource. Landed in the matter-upload redesign without this entry, which is what left the conformance suite red on main.",
  // The four notification-settling routes. They DO write — a read receipt on the member's own feed
  // row — and are exempt on the aiDetection.detect reasoning rather than the pure-computation one:
  // the write records nothing about the firm's conduct, only that one member cleared one badge, and
  // it fires once per item cleared. Auditing it would put a row in audit_log every time somebody
  // glanced at their notifications, flooding the one table a firm actually needs to be able to read.
  // The rows are also swept on the firm's retention window, so an audit trail would outlive the fact
  // it described.
  "notifications.markRead":
    "A member's read receipt on their own feed row — no firm-domain state changes, and auditing every badge clear would flood audit_log.",
  "notifications.dismiss":
    "As notifications.markRead: the member settling their own feed row, which records nothing about the firm's conduct.",
  "notifications.restore":
    "As notifications.dismiss, undone: the member putting their own feed row back, which records nothing about the firm's conduct.",
  "notifications.markAllRead":
    "As notifications.markRead, bounded by a cursor from a page the member actually read — one member clearing their own backlog.",
  "connectedAccounts.startGoogleSignIn":
    "As connectedAccounts.startMicrosoftSignIn: returns the provider's sign-in address and sets a short-lived signed cookie — no write.",
  "connectedAccounts.startMicrosoftSignIn":
    "Pure credential mint: returns the provider's sign-in address and sets a short-lived signed cookie — no write. The connection is recorded and audited by the return route.",
};
