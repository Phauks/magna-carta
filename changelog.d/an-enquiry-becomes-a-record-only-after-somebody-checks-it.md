---
category: Added
audience: public
---

**Accepting a public-form enquiry creates the contact and opens the intake, from what a member confirmed rather than from what a stranger typed.** `GET .../submissions/{id}/acceptance-proposal` maps a submission's answers onto the record a member would create and commits nothing; `POST .../submissions/{id}/acceptance` writes the Directory entity, the intake and the client party link in ONE batch from the confirmed values. The batch is the design, not a convenience: the Directory is soft-delete only and a merged-away alias deliberately stays in the corpus, so an entity written by a sequence that then failed to write its matter would be in the firm's permanent conflicts corpus forever with nothing to show for it. `composeCreateIntakeMatter` (`packages/matters/src/matter-service.ts`) and `composeCreateOrganization` (`packages/directory/`) were extracted for exactly that, and `renderDisplayName` is exported so the matter's display-only client name and the Directory's own rendering cannot drift. `apps/web/src/lib/intake-forms/accept-enquiry-dialog.svelte` is the review sheet, and it keeps the raw answers on screen beside the fields being corrected.

Two defects in the triage operation, which predated acceptance, are fixed with it: `accepted` was a state a bare state string could write — leaving rows claiming a matter existed with nothing to point at — and triaging an already-accepted submission violated `intake_form_submission_accepted_state_check`, answering a member with an Error ID for a constraint they could not read. Triage now takes `declined` and `spam` only, and refuses any decision on an accepted submission with a 409.

## Public

**An enquiry becomes a contact only after somebody has checked it.**

**Accept** on a form's submission now opens a sheet with the visitor's answers already sorted into the fields a record needs — their name in its parts, the matter's title, who will carry it — and every one of them is yours to correct before anything is written. What they actually sent stays on screen beside it, so a member fixing "jonh" to "John" can see what arrived and that nothing else in the enquiry contradicts the correction.

The reason it is a sheet and not a button is that your directory is kept for good, so a conflicts check can still find what is in it. A name mistyped on a web form would sit in your permanent record under that spelling, and you would find out when a check missed. The name split in particular is a guess — we split what was typed on the spaces, which is wrong for plenty of real names — so it is offered as three editable boxes rather than as an answer.

When you accept, three things happen together or not at all: the contact goes into your directory, a matter opens in intake with that contact as the client, and the enquiry is linked to both. The enquiry keeps what was originally typed — correcting a record must not rewrite the account of what somebody sent.

Declining and marking as spam are unchanged and still create nothing. An enquiry that has been accepted takes no further decision: the contact and the matter it created do not un-create, and the screen now says so instead of failing.
