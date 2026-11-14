# Admin documentation

Setup and administration for the firm owner / administrator: onboarding, users & roles, locations/offices, trust & billing configuration, integrations and credentials, backups/export, and offboarding.

Plain language, task-oriented — same pattern as the end-user guides ([`../README.md`](../README.md)), aimed at the person configuring the firm rather than using day-to-day features.

- [Roles and sub-roles](roles-and-sub-roles.md) — the roles a firm starts with, Admin for whoever
  administers the firm, Partner and Associate as kinds of Attorney, giving someone a sub-role, and
  how a rate card prices them.
- [Firm Profile](firm-profile.md) — the name clients read on invoices, in the portal and on
  generated documents.
- [Firm Brand](firm-brand.md) — the firm's primary mark and the images kept beside it, and why an
  office's letterhead prints the primary mark until the office has a logo of its own.
- [Offices](offices.md) — the register of the firm's offices; opening one with its country-shaped
  addresses, each with its own telephone, its email, time zone and numbering code; who works at an
  office and which is their primary; the letterhead logo and its printed width; the firm's default
  office; and closing an office.
- [Trust money-out approvals: your firm's policy](trust-disbursement-approvals.md) — who has the
  authority to release money out of client trust ledgers (and take earned fees against bills),
  whether larger payments take a second person as well, and how a payment reaches somebody who can
  release it when the person raising it cannot.
- [Numbering](numbering.md) — the shape of every number the firm draws (matter, consultation,
  intake, conflicts check and custody numbers), written as a list of parts with one counter; which
  parts restart the count; the preview; the numbers whose shape is fixed; why a number already drawn
  is frozen; and setting one matter's number by hand.
- [Event types](event-types.md) — the vocabulary a setting is classified under: the platform's
  shipped types (recategorized or retired, never renamed), the firm's own (added, renamed, retired),
  and why retiring is one way.
- [The trust compliance report policy](trust-compliance-report-policy.md) — what the firm's trust compliance report lists, decided once: ledgers at zero, and who authorized each payment.
- [The first day of the week](calendar-week-start.md) — the day every calendar in the firm begins
  its week on, why it is the firm's setting and not each member's, who can change it, and what a
  change does and does not move.
- [File retention](file-retention.md) — the fewest years a closed matter's paper file is kept, which
  sets the earliest destruction date a close accepts; why the firm starts with no minimum, who may
  change it, and why nothing is destroyed when a date arrives.
- [Turning AI on for your firm](ai-and-the-assistant.md) — the two separate switches (whether your
  firm's content may reach a model at all, and whether the assistant is one of the things that may
  send it), why one does not follow from the other, the model your content reaches and the two facts
  stated about it, the daily question ceiling, who may change any of it, and what closing a switch
  does to questions already sent.
- [Your firm's meeting settings](../features/meetings.md#your-firms-meeting-settings) — whether the
  firm's meetings may be recorded, summarized and captioned, the most people one recording hears and
  why that cannot pass eleven, why a summary also needs AI processing, what the page says when the
  platform's recording service is not set up yet, and who can change any of it.
- [Turning on question-and-answer document search](natural-language-document-search.md) — what the
  feature copies and where, the two things the disclosure declines to guarantee (data residency, and
  provable erasure from the managed store), leaving a matter out, what turning it off can and cannot
  demonstrate, and how it is counted while it is a beta (backend built, screens pending).
- [Checking that uploads can reach the firm's storage](upload-readiness.md) — what to do when an
  upload says storage did not answer: the check that runs from the version chip's Database section,
  its copyable report, what it puts right on its own, and the two things it can only name.
- [Opening files](opening-files.md) — what the one Open gesture does for every kind of file: the
  six ways a file can open, the families and extensions under each, and why the page is a routing
  table with nothing to change yet.
- [Deleted files](deleted-files.md): how long a deleted file waits in a matter's Trash, and whether it then moves to archive storage.
- [File safety and scanning](file-safety-and-scanning.md) — how deep every upload is scanned (Core,
  Extended or Full, and what each means), the engine that scans it, the suspicion threshold, what
  the firm may do with a flagged file, and who can change any of it.
- [Search and indexing](search-and-indexing.md) — whether the words inside the firm's files are
  searched: what turning it on reads and where the index is kept, how long the files already held
  take, what the page says while the platform's search service is not connected, and who can
  change it.
- [Editing](editing.md) — whether every document opened in the browser editor records its changes:
  what recording does and does not change for the member typing, where the marks are seen, what
  switching it off means, and who can.
- [Connecting your postage account](postage-account.md) — the firm's own carrier account, under
  Settings › Integrations: connecting it, reading its health, why the key is never shown again and
  can only be replaced, disconnecting, and the two permissions a member needs to spend postage.
- [The beta branch](beta-branch.md) — running the build ahead of the released one: what joining
  asks you to accept, why cancelling leaves the switch off, stepping back, and the alpha channel the
  platform sets.
