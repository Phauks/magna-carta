---
category: Fixed
audience: internal
---

**Registering a template while the scan engine was down handed the member an Error ID for something
only waiting could fix.**

The malware scan has three states and only two of them are verdicts: no engine wired at all is an
honest `unscanned`/`no-engine`, an engine that answers is a real verdict, and an engine that is bound
but will not answer is a **fault**. `routes/files/scan-diagnose.ts` already answered that third state with a
retryable `503`, on the reasoning that a member asking whether a file is safe must not be sent to
support over a Container that is simply not up.

Template registration raised the same fault as a `500`. `POST /api/v1/templates` and the versions
route now answer it the way the diagnose route does, and the staged upload is deliberately left in
place so a retry does not mean re-uploading the file.

**No row commits, and bytes are a separate question.** The effect throws before its write, so nothing
lands in the database. The prepared template is already in R2 by then — it is written inside the
effect, ahead of the scan — and each execution mints a fresh version and key, so every refused
attempt leaves another full copy under `templates/` that no row points at. The storage reconciliation
sweep does not reach it: that pass lists `files/` and `bulk/` only, and corrects the meter rather than
deleting anything. The leak predates this change — the Error ID it replaced left the same object
behind — but a retryable answer invites the retries that multiply it, and it is filed rather than
fixed here because reclaiming orphaned template bytes is a sweep, not a route.

**Why it was wrong in the first place, and where the fix had to go.** The scan runs inside
`runIdempotentEffect`, whose callback owes a write plus a response code rather than a `Response`. An
earlier attempt put the handler inside that callback, which does not typecheck against the contract;
the refusal belongs one level out, in the handler, where a `Response` is what gets returned. Both call
sites go through one `refuseOnScanFault`, which rethrows anything that is not a `ScanFaultError` — a
fault is the only thing this catches, and a real bug still surfaces as one.

Adding a declared response changes the API contract, so the committed OpenAPI snapshot and the
generated client move in the same commit. Only the two routes that scan gained the `503`.
