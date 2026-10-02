# Meetings — scheduling and booking pages, design

**Status:** Design, 2026-09-24. The rest of `meetings.scheduling`: scheduling from the product with people outside the firm on it, reminders, the meeting following its event through a move and a cancellation, and the booking page.
**Over:** [`2026-09-18-meetings-design.md`](2026-09-18-meetings-design.md) section 13 (scheduling IS recording an event with a medium on it) and [`2026-09-20-meetings-external-guests-design.md`](2026-09-20-meetings-external-guests-design.md) (the signed guest link, the guest lane, the guest stay). Everything those settle stands. This spec adds no second meeting record, no second form and no second way into a room: a booked visitor is a Directory person on a calendar event holding that design's guest link, and a reminder is a scheduled send against a meeting that already exists.
**Beside:** [`2026-08-07-calendar-slice-2-firm-events-and-resources.md`](2026-08-07-calendar-slice-2-firm-events-and-resources.md) (firm events, and the resource booking this spec must not be confused with), [`2026-08-06-notifications-delivery-design.md`](2026-08-06-notifications-delivery-design.md) (the registry every member-facing announcement goes through), [`2026-08-16-billing-automations-design.md`](2026-08-16-billing-automations-design.md) (the `invoice_reminder` precedent this spec's reminder record follows).
**Conventions that bind here:** [`docs/conventions/dates.md`](../conventions/dates.md) above all — a booking page is the first surface in the product that shows a firm's time to somebody in another zone and has to be right about it.
**White paper:** _Communications layer_; _Calendar and rules-based docketing_; _Client portal_ (the `PortalGrant` model the public lane is deliberately smaller than); _Authentication, access control & encryption_; _Notifications_.
**Ledger:** `meetings.scheduling` and `meetings.scheduling.booking-pages` in [`roadmap.d/meetings.md`](../../roadmap.d/meetings.md). The build moves `booking-pages` to `designed` and then `in-build`, pointing at this file; this document edits no ledger node itself.

## 1. What this settles

**A word first, because the calendar already owns one.** `firm_resource_booking` is a room or a car held for an event, and `/api/v1/events/{eventId}/bookings` reads those. What a visitor holds on a member's page is therefore called an **appointment** everywhere in code and contract (`booking_appointment`, `bookingAppointment_`), and the page it is taken on is a **booking page**. The product says "booking page" to members because that is the thing's ordinary name; it never says "booking" alone for an appointment.

Nine decisions carry the design.

1. **Scheduling from the product stays one act on one form.** The event form already writes the event and its meeting in one batch (`openMeetingOnEvent`, `apps/api-worker/src/routes/calendar.ts`). What changes is that the **Directory people on the event are now invited in that same act** — each one gets the guest design's signed link — and that reminders are planned in the same batch. The form's sentence that says a client "is not sent a way in yet" is retired.
2. **The meeting follows the event, and so does everything hanging off it.** Moving an event moves nothing on the meeting (it has no time of its own), but it re-plans the reminders, reissues each guest's link so it still reaches past the new end, moves the appointment the event carries, and tells the people outside the firm. Cancelling ends a scheduled meeting in the same batch (already built), withdraws the reminders, and tells them too.
3. **A reminder is a row, not a timer.** `meeting_reminder` is the schedule: one row per person, per lead, per start instant, with a UNIQUE index that is the convergence — the billing precedent, where the record carries the "once" and the notification is only a pointer to it. The wake that acts on those rows is **a per-firm Durable Object alarm** armed at the soonest pending row. A queue cannot hold the schedule: a delayed message waits at most twenty-four hours (verified against the Queues documentation, 2026-09-24), and a day-before reminder for a meeting booked a month out is a month away.
4. **A booking page is a member's standing offer, published at a signed address.** The address carries the firm and the page under the worker's own signature, so a public route turns away every address it did not mint with no database read, and resolves the firm without a control-plane table or anything a visitor typed.
5. **A visitor holds a time, then proves their mailbox, and only then becomes anybody.** The first request holds the slot for fifteen minutes and mails a link; nothing reaches the Directory, the calendar or the conflicts corpus until that link is used. Proven possession of the mailbox is the same assurance tier the guest link already rests on, and it is the only thing that makes matching the visitor to an existing Directory person safe.
6. **A confirmed visitor is matched to one Directory person by that proven address, or entered as a new person marked `needs_review`.** The member whose page it was reviews every appointment once: keep the person, merge them into one the firm already had, or discard them.
7. **A booked appointment is a firm event** on the member's own calendar (the staff arm of the event form: audience `participants`, the member listed first), with the visitor as a Directory participant, a meeting of the page's medium, and the visitor's guest link. It carries no matter and no matter identifier ever reaches the public side.
8. **The slot computation is a pure function over instants.** A page's hours are wall clocks in the member's zone, the member's calendar entries are wall clocks in each entry's own zone, and the visitor is somewhere else again — so unlike the event form's availability line, which compares what the grid paints, a slot is compared as a moment. The visitor reads every slot in their own zone; the event is recorded in the page's.
9. **The public side is a lane at the chokepoint of its own, on the guest lane's shape where the shape fits** — step zero, a signed credential, a firm resolved from it by a method of its own, never a user id or a permission stashed — and on its own terms where it does not: the page address is public and never secret, the appointment credential is the visitor's, and there is no socket.

## 2. What is already built, and what this starts from

Built and unchanged here: the event form's Meeting choice with its lobby switch (`apps/web/src/lib/calendar/event-draft.ts`, `record-event-dialog.svelte`); the event and its room committed in one batch, with the scheduler holding the host grant (`openMeetingOnEvent` in `packages/meetings/src/meeting-service.ts`); the `calendar.event.meetingScheduled` topic and the `named-members` invitation for a matter event; the refusal to cancel an event whose meeting is live (`meeting-in-progress`); the scheduled meeting ended with its cancelled event (`endScheduledMeetingForCancelledEvent`); the availability line on the Who tab, which states and never refuses (`member-availability.ts`, `availability-reads.svelte.ts`); and New Meeting on the Meetings page.

Built by the guests stream and consumed here: `meeting_guest_invitation` and `meeting_guest_stay`; `inviteGuest`, `rotateGuestLink`, `revokeGuestLink` (`packages/meetings/src/guest-service.ts`); the signed-token format (`apps/api-worker/src/signed-token.ts`); the guest lane (`guestLane` in `apps/api-worker/src/contracts/route-meta.ts`, step zero in `chokepoint.ts`); the invitation mail and `eventEndInstant` (`apps/api-worker/src/meetings/guest-invitation-mail.ts`); the arrival page at `/join/<token>`; the host's Guests panel.

Two limits carried forward rather than fixed, because each is a table rebuild that cannot complete against a firm database holding data (`packages/database/src/reviewed-rebuilds.ts`):

- **`notification_event.subject_kind` has no `firmEvent` value.** A member is therefore still not notified about a firm meeting a colleague scheduled. This spec finds a subject for the one firm-event case it needs — an appointment, which has a Directory person to point at (section 10) — and does not pretend to have solved the general one.
- **`meeting_attendance.user_id` stays NOT NULL**, which the guests design already worked around with a second stay table. Nothing here touches it.

## 3. Scheduling from the product

### 3.1 The act

A member opens the event form from the calendar, a matter, or New Meeting on the Meetings page; picks who (colleagues from the roster, people and organizations from the Directory, externals typed once), when, and a medium on the Where tab; and saves. The save writes, in **one** batch: the event and its participants, the meeting and the scheduler's host grant, a guest invitation for each invitable Directory participant (section 3.2), the reminder rows (section 4), the audit rows, and the `calendar.event.meetingScheduled` outbox message for a matter event's colleagues. After the batch commits, the handler sends the guests' mail. That is the whole of it, and it is the design's existing ordering: every durable fact in one batch so an idempotent replay answers with all of it, every send after the commit so nobody is written to about something that rolled back.

### 3.2 Directory people are invited in the same act

A participant of kind `entity` on an event with a meeting is **invitable** when it has a contact point to send to: the entity's primary email row that is live and `contact_permitted = 1`, else its first such row. An entity with none is **not invitable**, and the event still records — the form says which people will not be sent a way in, before the save, rather than after.

The invitation is composed **inside** the event's batch through a new seam in `guest-service.ts`, `composeGuestInvitation`, for exactly the reason `openMeetingOnEvent` exists: `inviteGuest` reads the meeting and the event through the visibility predicate before writing, and at this moment both are composed and uncommitted, so no read can see them. The seam takes what the route already knows — the meeting handle, the entity, the chosen email row, the event's end instant, the issuing member — and composes the same rows `inviteGuest` would, with the secret returned to the caller for the one mail and written nowhere. Like `openMeetingOnEvent` it is exported under its own name so that skipping the read is a decision a caller takes deliberately, and it has two callers: this route and the appointment confirmation (section 5.3).

**A link that cannot reach the meeting is not minted yet.** The guests design's expiry is `min(mint + GUEST_LINK_MAX_DAYS, max(eventEnd, mint) + GUEST_LINK_GRACE_HOURS)`, so a link minted today for a meeting three weeks out would expire a week before it. Rather than widen the ceiling, the invitation is **deferred**: the save sends an announcement instead — the firm, the title, the start, and the sentence _"Your link to join will be sent to this address on <date>"_ — and writes a `meeting_reminder` row of purpose `invitation` due at `eventEnd + GUEST_LINK_GRACE_HOURS − GUEST_LINK_MAX_DAYS`, the first instant a minted link reaches the end. The reminder pass (section 4.3) mints it then. Nothing about the credential's life changes; the only thing deferred is the moment it exists.

The event create response (both paths, `POST /api/v1/matters/{matterId}/events` and `POST /api/v1/firm-events`) gains `guestInvitations: [{ entityId, outcome, errorId? }]`, where `outcome` is `sent`, `scheduled` (deferred, with the date the link goes out), `not-invitable` (no address) or `not-sent` (the mail failed after the commit; the invitation exists and the host resends it from the Guests panel, which rotates the link and mails it). The form reports a `not-sent` the way it already reports a room it could not hold: the event is never unwound for it.

An edit that **adds** an entity participant to an event with a meeting invites them the same way. An edit that **removes** one revokes their live link in the same batch and withdraws their reminders; the guest lane's live-invitation read then refuses the old link, and the host-controls removal act closes a stay already in the room after the commit, as the guests design's revocation does.

Mint, reissue and revoke on this path ride what the route already required: `calendar:manage` for the event and `meetings:host` for anything touching a room. Inviting the Directory people the member put on the event is part of the act of opening the room, not a second act needing a second key.

The form's two sentences under the Meeting choice become:

> Everyone at the firm on this event is invited, and each person from the Directory is sent a link to join by email.

and, for a firm event, where colleagues are still not notified:

> Nobody at the firm is notified about a firm meeting yet, so tell your colleagues yourself. Each person from the Directory is sent a link to join by email.

### 3.3 Availability

Built, and unchanged. The Who tab reads each colleague's day through the member filter the server resolves in SQL and states what the grid paints at that hour. It compares civil days and wall clocks, which is right for what it paints and is a known approximation when a colleague's entries sit in another zone; the slot computation in section 6 cannot make that approximation, and says why there. Directory people have no calendar here and are not asked about.

### 3.4 Confirmation

The scheduler's confirmation is the save's own answer: the meeting handle, Join on the entry window from the moment the event exists, and the `guestInvitations` outcomes stated under the form's commit bar. Colleagues on a matter event get the `meetings.meeting.scheduled` notification (built). Directory people get the invitation mail (built by the guests stream) or the announcement.

### 3.5 Rescheduling: the meeting follows the event

An edit that changes when an event happens — its dates, its times or its zone, the same test that raises `calendar.event.rescheduled` today — composes, beside the event update and in the same batch:

- **The reminders are re-planned.** Every pending row for the old start is withdrawn with reason `rescheduled`, and the rows for the new start are inserted (section 4.1). Rows already sent stay as they are: a day-before reminder that went out for Tuesday is a fact about Tuesday.
- **Each live guest link is reissued or deferred.** Where a link minted now reaches the new end, the invitation is reissued through a second seam, `composeGuestLinkReissue` — a fresh secret, a new `expires_at` from the new end, `secret_version` incremented — so the old link stops at once and a link that would have expired before the moved meeting cannot survive. Where it does not reach (the meeting moved far out), the invitation is revoked and an `invitation` reminder row is scheduled. After the commit each guest is mailed _"The meeting has moved"_ with the new start and either the fresh link or the date it will come.
- **The appointment the event carries moves with it** (section 5.9), and its visitor is mailed the same way.

The meeting row is not touched. An edit that changes only the title, the room or the description does none of this.

### 3.6 Cancelling

A cancel of an event with a scheduled meeting already ends the meeting in the same batch and refuses while the meeting is live. It additionally withdraws every pending reminder with reason `cancelled`, marks the event's appointment `cancelled` by the member, and after the commit mails every guest and the visitor _"The meeting has been cancelled"_. No link needs revoking: the guest lane already refuses every link on a meeting that has reached `ended`.

## 4. Reminders

### 4.1 Who is reminded, of what, and when

Two leads, a closed vocabulary: **`day-before`**, twenty-four hours before the start, and **`quarter-hour`**, fifteen minutes before. A lead whose instant has already passed when the row would be written is not written — a meeting scheduled at 16:00 for 16:10 gets no quarter-hour reminder rather than a late one.

- **Members named on the event** (participant kind `member`, the scheduler included — being reminded of your own meeting is useful where being invited to it is not) are reminded in the product through the notifications registry. For a matter event the subject is the event. For an appointment the subject is the visitor's Directory person (section 10). For any other firm event there is no member reminder, for the subject-kind reason in section 2, and the form does not claim one.
- **Directory people holding an invitation**, and the visitor on an appointment, are reminded by email.
- **An `all_members` firm event** reminds nobody: a firm-wide list decays with every hire, which is the audience column's whole reason to exist, and a reminder fan-out to everybody for a training is not a reminder.
- **A recurring event** plans no reminders in this slice. A series is one row expanded at read, a reminder is one start instant, and planning a row per occurrence of a year-long weekly series would materialize exactly what the recurrence model refuses to materialize. The form says so beside the Meeting choice when a repeat is set.

What rows an event wants is a pure function, `plannedReminders(event, meeting, recipients, now)` in `packages/meetings/src/reminder-plan.ts`, and what an edit does is `reconcileReminders(planned, existingPending)` beside it: rows to insert and rows to withdraw, compared by `(recipient, lead, eventStartsAt)`. Both are unit-tested without a database, and every write path — create, edit, participant change, cancel, appointment confirmation, appointment move — goes through them rather than composing rows by hand.

**The due instant is computed once, at the write, and stored**, on the guest link's precedent: `dueAt = eventStartsAt − lead`, where `eventStartsAt = instantForCivilDateTime(startsOn, startsAtTime, timeZone)` in the event's own zone. It is a subtraction of a duration from an instant, not a date derived from a date, and nothing re-derives it at read time. An all-day event's start is the start of its civil day in its own zone. The start instant is stored beside it (`event_starts_at`), which is what lets a pass notice a row an edit should have withdrawn and did not.

### 4.2 Where the schedule lives

**The table is the schedule; a per-firm Durable Object alarm is only the wake.** Three places were considered.

- **A queue with a delay.** Refused on a hard limit: a Cloudflare Queues message can be delayed at most twenty-four hours, so a day-before reminder for anything scheduled more than two days ahead cannot be enqueued when it is written. A chain of re-enqueues would put the schedule in the queue's in-flight state, where a move or a cancel cannot find it to withdraw it.
- **The five-minute cron sweep.** It already reads every firm for the outbox relay, so one more indexed read per firm per pass looks free. It is not the right home, for the reason the conflicts backstop gives in `apps/api-worker/src/scheduled.ts`: `scheduleRequestPathSweep` runs that sweep on the tail of a provisioning request, and sending mail in a firm's name on the tail of somebody else's request is work that must not go on a request path. It would also read every firm's reminder table every five minutes to find, almost always, nothing.
- **The meeting's own `MeetingRoom` alarm.** Per meeting, and already reconciling several deadlines. Refused because the room is signaling state that is deleted when the last socket closes, and a room that has never been joined has never been addressed; loading the room with scheduled mail is the "object that knows everything" the structure section of the meetings design split the room to avoid.

So: **`MeetingReminderClock`**, a Durable Object keyed by firm id, whose only state is the firm id it serves and whose only job is its alarm. `armFor(instant)` sets the alarm to the earlier of the one already set and the one asked for — never later, on the room's `armAlarmFor` rule — so a caller can arm it freely and a stale arm costs one wake that finds nothing. Every write path that inserts a pending reminder calls `armFor` with the soonest `dueAt` it wrote **after its batch commits**, the way the guest routes call the room after theirs. Every wake ends by re-arming from the table itself (`MIN(due_at) WHERE state = 'pending'`), so the alarm is a cache of one indexed read and never the authority. It needs one binding and one migration entry in `wrangler.jsonc` beside `MEETING_ROOM`.

### 4.3 The pass

On each wake the clock runs `runReminderPass(firmId)` (`apps/api-worker/src/meetings/reminders/reminder-pass.ts`) through the firm-scoped data-access layer, as the room's grace sweep closes stays from inside its alarm:

1. **Read the due rows**, at most `REMINDER_PASS_BATCH = 50`, `state = 'pending' AND due_at <= now`, ordered by `(due_at, id)`, joined to the meeting's status and the event's current timing and status. One statement over the partial index; no per-row read.
2. **Withdraw what is no longer true**, in one batch: a meeting that has ended or an event that was cancelled (`ended`, `cancelled`); an event whose current start instant is not the row's `event_starts_at` (`rescheduled` — the edit path should already have done this, and this is the belt); and any reminder whose `event_starts_at` is already past (`late`). **A reminder is never sent after the start it reminds of.**
3. **Member rows**: settle the row `sent` and write the outbox message in **one** batch — the record and the announcement commit together or not at all, exactly as `invoice_reminder` and its topic do. Notifications subscribes as an ordinary `outbox-topic` type (section 10). The relay publishes on its five-minute cycle, so a member's quarter-hour reminder lands between fifteen and ten minutes before the start; that bound is stated here rather than discovered.
4. **Guest reminder rows**: **send first, mark second**, the digest's rule. A crash between the two sends a reminder twice, which is an annoyance; marking first risks sending none. The reminder mail carries **no credential**: the invitation row stores only a hash, so the database cannot mint a working link and a reminder cannot carry the one already sent. It names the mail that did (_"Join with the link in our message of <date>, subject <subject>"_).
5. **`invitation` rows**: mint the link through `inviteGuest` — which, for an entity that already has an invitation on this meeting, rotates it rather than adding a second — and commit; then send the invitation mail with the fresh link; then mark `sent`. A retry after a failed send rotates again, so the mail that finally arrives always carries the only link that works.
6. **A send that fails** increments `attempt_count` and leaves the row pending, re-armed ten minutes out; the third failure settles it `failed` with the Error ID from the standard pipeline. **A mail port that is not provisioned** stops the pass before anything is sent or marked, re-armed an hour out, and is counted: the reminder pass resolves its port on the digest's precedent (`apps/api-worker/src/notifications/digest-send-port.ts`), never through the shared resolver that falls back to a logging adapter, because a reminder "sent" to nobody and marked sent is a reminder nobody will ever get.
7. **Re-arm** from the table.

### 4.4 The backstop

A Worker that dies between a commit and its `armFor` leaves a pending row with no alarm to wake for it. The daily pass (`RECONCILIATION_CRON` in `apps/api-worker/src/event-dispatch.ts`) therefore reads, per reachable firm, `MIN(due_at)` of its pending rows and arms that firm's clock — one indexed read per firm per day, isolated per firm like every other daily step. The worst case of a lost arm is a reminder up to a day late, and the pass's own `late` rule turns that into a reminder not sent rather than one sent after the meeting.

## 5. Booking pages

### 5.1 What a page is

A booking page belongs to one member and says, in their own terms, when a stranger may take a meeting with them: the heading and a short public description; the medium (video or audio call); the duration; the step between offered start times; a buffer before and after; the minimum notice; how many days ahead; an optional ceiling per day; **the zone the page's hours are read in**, defaulted from the member's office and changed per page like an event's; the weekly hours as wall-clock windows per weekday; and an optional firm-category event type the booked event carries. A member may have several pages — a thirty-minute consultation and a fifteen-minute follow-up are two pages.

There is no table of days off. A member who is out on Friday puts an all-day entry on their own calendar, and the page stops offering Friday, because **the page offers a time exactly when the member's own calendar has nothing there** (section 6.3). A second record of absence would be a second answer to where the member is.

A page is `draft`, `published` or `retired`. Publishing needs three things at once, and the confirmation of every appointment re-reads all three: the firm's policy switch `meetings.bookingPages.enabled` (default **off**: a page taking bookings from strangers in the firm's name is an act in the firm's voice, and a platform that starts doing it the day it deploys has decided how the firm meets the public — the billing automations' reasoning for reminders, applied here); the owner holding the new key `meetings:publishBookingPages`; and the owner holding `meetings:host` and `calendar:manage`, because what a page does on the owner's behalf is open a room and record an event. An owner who is deactivated or loses any of those keys has pages that answer as unavailable from that moment.

### 5.2 The address

A published page is reached at **`/book/<address>`** on the application's own origin, outside the `(app)` route group, on the guest arrival page's four reasons (the portal host does not exist; the media permissions and the socket's origin check are this origin's — relevant here because the booked visitor later joins at `/join/`; no operator step; an SPA path on the existing asset serving).

The address is a token in the one signed format (`apps/api-worker/src/signed-token.ts`) with `typ: "booking-page-address"` and payload `{ firmId, bookingPageId, addressVersion }` — no secret and no expiry, because it is not a credential anybody is meant to keep private. What the signature buys is the property the guest link's signature buys: a public route rejects every address the worker did not mint without reading anything, so a stranger's guessing is never billable storage traffic and the firm is resolved without a control-plane lookup keyed by something a visitor typed. Because HMAC is deterministic the address is stable across mints, so the page read hands it back rather than storing it. **Rotating** the address increments `address_version`; every old address then refuses, which is what a member does when a page has been posted somewhere it should not be.

A human-readable slug (`/book/hollis-law/jane-hollis`) was the obvious alternative and is not taken in this slice. It needs a control-plane table mapping a global name to a firm, read on every request including every junk one, and a namespace that is first-come across firms. Both are real questions and neither is this slice's (section 14).

### 5.3 The visitor's path

1. **Open the page.** `GET /api/v1/booking/page` answers the public summary: the firm's name, the member's display name, the page's heading and description, the medium, the duration, the page's zone. Then `GET /api/v1/booking/page/slots?from=&to=` answers the offered slots as instants for a window the browser asks for, at most `MAX_SLOT_WINDOW_DAYS = 15` wide — a refusal over it, never a clamp. The browser groups them into the visitor's own days. Nothing is written.
2. **Pick a time and say who they are**: given name, family name (optional, for a person with one name), email address, and the zone their browser reports — shown, and changeable, beside the slots.
3. **Hold it.** `POST /api/v1/booking/holds` re-computes the slot on the server, inserts a `held` appointment through a guarded statement (section 7.3), and after the commit mails **"Confirm your meeting with <member> at <firm>"** carrying the appointment link. The page says: _check your email; the time is held for fifteen minutes._
4. **Confirm.** The link opens `/book/manage/<token>`, which reads the appointment (`GET /api/v1/booking/appointment`) and spends nothing on open — the joining mails' property, which a prefetching mail client and a corporate link scanner both need. The visitor presses **Confirm** (`POST /api/v1/booking/confirmation`), and in **one** batch: the Directory person is matched or created (section 5.5); the firm event is recorded with the member and the visitor as participants; the meeting is opened on it with the member holding the host grant; the visitor's guest invitation is composed (or deferred, section 3.2); the reminders are planned; the appointment becomes `confirmed` with the handles of all of it; the audit rows and the `meetings.appointment.confirmed` outbox message ride along. After the commit: the confirmation mail with the guest link, and `armFor` on the reminder clock.
5. **Later**, the same link manages the appointment — reschedule to another offered time, or cancel — until two hours after it ends.

**One link, sent once.** The hold mail is the only mail that carries the appointment link, and it serves for the appointment's whole life. The alternative — rotating it at confirmation so the confirmation mail can carry a fresh one — would put a bearer credential in the confirmation response, and a required-idempotency response body is stored and served verbatim to whoever retries the key. Every later mail names the hold mail by its subject instead.

A hold that is not confirmed **lapses**. It stops blocking the slot at `hold_expires_at`; a confirmation after that instant succeeds only if the time is still free; and the daily pass settles lapsed holds `lapsed` and blanks the address they carried (section 7.3), so an unconfirmed visitor's address is kept for at most a day and a quarter of an hour.

### 5.4 Why a hold and a confirmation, rather than a booking

Instant booking is what most booking products do, and it is the wrong default here for four reasons, in the order they bite.

1. **Matching needs a proven address.** Attaching a visitor to an existing Directory person by an address a stranger typed would let anybody attach themselves to a firm's real client — and the member would then see that client's name on the event, admit "them" from the lobby, and file the meeting under a person who was never there. After the visitor proves the mailbox, a match by that address is exactly as strong as the guest link the firm would have sent that person anyway.
2. **The Directory is the conflicts corpus.** Every new person raises `directory.entity.created`, which the conflicts recheck consumes. An unconfirmed form submission must not be able to write into the corpus or cost a recheck.
3. **A calendar event is a member's commitment.** A held slot costs the member fifteen minutes of one slot; a spam booking costs them a meeting on their calendar.
4. **Mail-bombing is bounded.** The worst a stranger can do with somebody else's address is cause one confirmation request mail to it, bounded per address (section 11.3); they cannot cause a confirmed booking, a reminder series, or a Directory record.

### 5.5 How a visitor enters the Directory, and what a member reviews

At confirmation, the held address is normalized by the Directory's own rule (the one that fills `directory_email.normalized_address`) and looked up against live email rows of **active persons**. Organizations are not matched: `info@` belongs to nobody in particular, and the arrival design already handles "the company sent whoever was free".

- **Exactly one person holds the address** — `matched`. That person is the participant and the guest. Their Directory name is not changed; the name the visitor typed is kept on the appointment, and the member sees both, as the guest lobby shows the invited name beside the typed one.
- **Nobody holds it** — `created`. A new person is composed from the two typed names with **`needs_review = 1`**, the column the schema already carries for provisional entries and nothing has written a 1 into until now; an email row is added with `verification_status = 'verified'` and `verified_at` the confirmation instant, because proving the mailbox is precisely what verification means for that row.
- **Several people hold it** — `created-ambiguous`. Guessing between two clients who share a family address is worse than not guessing, so a new provisional person is created as above, and the review lists the candidates.

`composeCreatePerson` gains a `needsReview` input (today it writes 0 unconditionally), and the creation's audit row carries a null actor, which `DirectoryWriteOptions` already allows: no member entered this person. The creation raises `directory.entity.created` like any other, so the conflicts recheck sees the new name — which is the point of a person being in the Directory at all.

**The review.** Every confirmed appointment is reviewed once by its page's owner, from **Appointments** under Meetings (section 5.8). A row shows the typed name, the Directory person, how they were reached (`matched`, `created`, `created-ambiguous`), the candidates where there were several, and whether the matched address is one the person asked not to be contacted at (`contact_permitted = 0`) — the visitor used it themselves, so it is stated, not refused. Three outcomes:

- **Keep** — the person belongs in the Directory as they are. Clears `needs_review` on a person this appointment created.
- **Merge** — the person is somebody the firm already had. `mergeEntities` (`packages/directory/src/merge.ts`) with the provisional person as the subordinate, under the Directory's own merge permission checked in the handler. The event participant, the invitation and the appointment keep the subordinate's handle, which resolves to the survivor through `merged_into_id` exactly as every reference outside the merge's repoint set already does.
- **Discard** — not a real person, or not somebody the firm will meet. Cancels the event through the cancel path (the visitor is told, as for any member cancel) and soft-deletes the provisional person through a new Directory function, `discardProvisionalPerson`, which refuses unless the person was created by this appointment, still has `needs_review = 1`, and is referenced by nothing in `REPOINT_REFERENCE_COLUMNS` — a person somebody has since put on a matter is no longer the review's to delete.

A matched person's review is **Keep** or nothing: discarding somebody the firm already knew is a Directory act, not an appointment's. **A conflicts check on a prospective client is not started by any of this.** Whether and when to run one is the intake procedure's decision, and the review is where the member sees that a stranger has become a Directory person — which is the moment they need to see it.

### 5.6 What the booked event is

A **firm event**, by the staff arm of the event form: audience `participants`, the page's owner listed first, the visitor second as participant kind `entity`. Its **title is the page's heading** ("Initial consultation"), never the visitor's name: a firm event's title is on the firm's grid for every member by contract, and a prospective client's name as a title would be broadcast where a participant row is not painted. Its type is the page's event type or none; its description is null; it carries no location and no conference link — the meeting is where it is joined. Its timing is the slot read in the page's zone: `startsOn` and `startsAtTime` from `zonedReading(startsAt, pageZone)`, `endsAtTime` likewise, `endsOn` set only where the slot crosses midnight in that zone, and `timeZone` the page's. **The event is stored in the member's zone and in no other**, so it sits on the member's calendar at the hour they offered.

The meeting takes the page's medium with the lobby off — the visitor waits at the door anyway, because a guest always does, and the member walks straight in.

**Attribution.** `meeting.created_by_user_id`, the host grant, `meeting_guest_invitation.issued_by_user_id` and `firm_event.recorded_by` all name the page's owner, and that is honest rather than convenient: publishing the page was the owner's standing act of offering exactly this meeting, and every one of those columns needs a member who answers for the room. The audit rows the composed services write therefore name the owner as actor, and the same batch carries `meetings.appointment.confirmed` with a **null** actor and the appointment's handle as subject, so the record says both who the meeting belongs to and that a visitor's confirmation is what caused it.

### 5.7 What the visitor sees, in their own zone

**Every time a visitor reads is an instant read in their zone, labelled with it**, through the design system's instant formatters — `formatInstantDate` and `formatTimeOfDay` with `timeZone` set to the visitor's and the zone's name shown. The page's own zone is shown once, beside the member's name: _"Jane Hollis works in Pacific Time; times below are in your time zone, Eastern Time. Change."_ The slot list is grouped by the visitor's own civil days, computed with `zonedReading(slot, visitorZone).civilDate`, so a slot at 21:00 Pacific on Tuesday appears under Wednesday for a visitor in Tokyo — which is the day it is for them.

The visitor's zone is what their browser reports, is sent with the hold, is checked with `isResolvableTimeZone` (an offset is refused, for the reason that rule exists), and is stored on the appointment so every mail can speak to it. **Every mail states the time twice**: in the visitor's zone first, and in the member's zone labelled — _"Wednesday, October 7 at 1:00 PM Japan Standard Time (Tuesday, October 6 at 9:00 PM Pacific Daylight Time, where Jane Hollis is)"_. The guests design's invitation mail writes only the event's zone because the server holds no reader's zone for a guest the firm typed in; an appointment visitor told us theirs, and not using it would be the one wrong answer available.

The visitor never sees: a matter, an event or meeting identifier, the member's user identifier, any other participant, or anything about why a time is not offered.

### 5.8 What the member sees

- **On their calendar**, the booked event at the hour they offered, with the visitor on the Who side as a Directory participant and Join on the entry window — the same entry window every event opens in, with nothing appointment-specific added to it, because the appointment is a way the event came to exist rather than a different kind of event.
- **In their notifications**, _"A visitor booked time with you"_ (and later _moved_ or _cancelled_), pointing at the visitor (section 10).
- **Under Meetings › Appointments**, their appointments — upcoming, past and awaiting review — each with the page, the visitor's typed name beside the Directory person, the time in the member's own zone, and the review actions of section 5.5.
- **Under Meetings › Booking pages**, their pages: the form of section 5.1, a preview of the next seven days of slots exactly as a visitor would get them (the same computation, through a member route), the address with **Copy**, **Rotate address**, **Publish** and **Retire**.
- **Under Settings › Meetings**, for a member holding `firm:manageMeetingPolicy`, the firm's switch for booking pages.

In the lobby the visitor is a guest like any other: their typed name beside the Directory name the link was minted for, and the member admits them. There is no "admit my own appointments automatically" setting, for the guests design's reason.

### 5.9 Rescheduling and cancelling, from either side

**The visitor** may cancel until the start and may move to any time the page offers, at most `MAX_APPOINTMENT_RESCHEDULES = 3` times and only while the current start is outside the page's minimum notice. A move re-computes the slot with the appointment's own current interval not counting against it, then composes, in one batch: the event's timing through the firm event update, the appointment's instants, the reminders re-planned, the guest link reissued or deferred (section 3.5). A cancel composes the firm event cancel — which ends the scheduled meeting and refuses while it is live, in the visitor's words: _"This meeting has started. You can leave it from the meeting screen."_ Both mail the visitor after the commit and raise a notification to the owner.

**The member** reschedules and cancels through the calendar, because the event is the record and there is one act for moving it. The firm event update and cancel paths look up the appointment by its `firm_event_id` (a unique index) and carry it along: a move rewrites the appointment's instants from the new timing read in the event's zone and mails the visitor _"Jane Hollis has moved your meeting"_; a cancel settles it `cancelled` by the member and mails the visitor. A member's move is never refused for landing on another appointment or on the page's hours — the calendar does not referee a member's own diary, and the page's rules bind strangers, not the person who wrote them.

Edits to a page bind new holds only; appointments already confirmed stand. Retiring a page or rotating its address changes nothing about appointments on it.

## 6. The slot computation

### 6.1 Why instants, and why not the availability line's comparison

The Who tab's availability line compares civil days and wall clocks without converting zones, because it prints what the grid paints and the grid never converts. A slot cannot be computed that way. The page's hours are wall clocks in the page's zone; each calendar entry is a wall clock in its own zone (a New York member's hearing in a Los Angeles court is stored in Los Angeles time); and the visitor is somewhere else. Comparing wall clocks across those would offer a New York member's 12:00 while they sit in a 9:00 Pacific hearing. So every one of the three is resolved to instants with `instantForCivilDateTime` in its own zone, and compared as instants — which is also the only form in which "the same moment for the visitor and the member" is a meaningful sentence.

### 6.2 The function

`bookingSlots` in `packages/meetings/src/booking-slots.ts` — pure, no clock, no database, no `Intl` of its own beyond what `@magna-carta/civil-time` does:

```ts
bookingSlots(input: {
  rules: {
    timeZone: string;                 // the page's zone; the hours are read in it
    durationMinutes: number;
    slotStepMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    minimumNoticeMinutes: number;
    maximumDaysAhead: number;
    maximumPerDay: number | null;
    hours: readonly { weekday: WeekdayCode; startsAtTime: WallClockTime; endsAtTime: WallClockTime }[];
  };
  busy: readonly { startsAt: CanonicalInstant; endsAt: CanonicalInstant }[];          // the member's calendar
  appointments: readonly {                                                           // live appointments on any of the owner's pages
    startsAt: CanonicalInstant; endsAt: CanonicalInstant;
    blockedFrom: CanonicalInstant; blockedUntil: CanonicalInstant;
    bookingPageId: string; startsOnInPageZone: CivilDate;
  }[];
  bookingPageId: string;
  window: { from: CanonicalInstant; to: CanonicalInstant };
  now: CanonicalInstant;
}): { slots: readonly { startsAt: CanonicalInstant; endsAt: CanonicalInstant }[]; truncated: boolean }
```

A candidate is generated for every civil day `d` in the page's zone from the day `window.from` falls on to the day `window.to` falls on, each widened by one day either side so no offset can hide a day, and for every hours window whose weekday is `weekdayOf(d)`: the window's start instant is `instantForCivilDateTime(d, startsAtTime, zone)` and its end likewise; candidates start at the window's start and every `slotStepMinutes` after it while `start + duration <= windowEnd`. Stepping is in elapsed minutes from the window's start instant, so a window that straddles a daylight-saving change keeps an even step rather than a repeated or skipped wall-clock time; a window opening inside a spring gap opens when the clock reaches it, which is what `instantForCivilDateTime` already resolves a gap to.

A candidate `[s, e)` is **offered** when all of these hold:

1. `s ∈ [window.from, window.to)`.
2. `s >= now + minimumNotice`.
3. `zonedReading(s, zone).civilDate <= addCalendarDays(zonedReading(now, zone).civilDate, maximumDaysAhead)` — "days ahead" is counted in the member's days, not UTC's.
4. `[s − bufferBefore, e + bufferAfter)` overlaps no `busy` interval. Touching is not overlapping: a slot may end at the minute a hearing starts, exactly as `schedule-conflicts.ts` treats back-to-back settings.
5. For every live appointment, `[s, e)` does not overlap its `[blockedFrom, blockedUntil)`, **and** its `[startsAt, endsAt)` does not overlap `[s − bufferBefore, e + bufferAfter)` — each side's buffers are its own, and neither is allowed to eat the other's.
6. Where `maximumPerDay` is set, fewer than that many live appointments on this page have `startsOnInPageZone` equal to the candidate's page-zone day.

The result is sorted ascending, de-duplicated by instant (two overlapping hours windows on one day must not offer a time twice), and capped at `MAX_SLOTS_PER_READ = 500` with `truncated` saying so rather than a silent cap.

### 6.3 What counts as busy

`readMemberBusyIntervals(database, userId, fromCivilDate, toCivilDate, options)` in `packages/calendar/src/member-busy.ts` reads what is **on the member's calendar** by the predicates the federated read already applies for `memberUserId` (`packages/calendar/src/sources/all.ts`): a matter event on which they are a participant or whose matter they are responsible for, and a firm event on which they are a participant or whose audience is `all_members`. Those two predicates are factored out of the sources into exported fragments and composed by both, so the page and the member's own calendar cannot come to disagree about what is on it. Cancelled events are not busy; a recurring row is expanded over the window with `occurrencesOf`, skipping the occurrence dates an exception row replaces, which is the calendar's own expansion.

Each row becomes an interval in its own zone: a timed entry from its start to its end (on `endsOn` where it spans days); an **all-day** entry across the whole of its civil days in its zone, from `instantForCivilDateTime(startsOn, "00:00", zone)` to `endOfCivilDayInstant(endsOn ?? startsOn, zone)`; and a timed entry **with no end** blocks `UNENDED_ENTRY_BLOCK_MINUTES = 60` from its start. That last is a stated, conservative assumption and not a derived fact: a hearing at 9:00 with no recorded end is not over at 9:01, and offering a stranger 9:15 against it is worse than withholding the hour.

**What leaves the function is two instants per entry and nothing else** — no title, no type, no matter, no participant, not even which kind of record it was. That is why it deliberately takes no visibility predicate: a walled matter's hearing must still block its responsible member's time, and a public page can learn from it only that a slot is not offered. The rescheduling route passes `ignoreFirmEventId` so an appointment's own event does not block its own move.

Deadlines are not busy. A deadline is a day something is due, not an hour somebody is occupied, and a page that closed every day a filing fell due would close most of a litigator's month.

### 6.4 Where it runs

In the public slot read, the hold, the confirmation (the time is re-checked; a busy read that disagrees now refuses with `appointment-time-taken`), the visitor's move, and the member's preview. The busy read and the appointments read are two statements issued together; the window cap bounds both. **Minimum notice binds the hold, not the confirmation**: a visitor who held a slot two hours out on a two-hour-notice page and confirms ten minutes later is not refused for the ten minutes the platform made them spend in their inbox.

## 7. Schema (per-firm lineage, additive)

Four new tables in `packages/database/src/per-firm-schema.ts`, one hand-written migration, the snapshot refreshed in the same commit, the worker bundle regenerated by `pnpm run migration-bundles`. No column is added to an existing table and no constraint is changed. Every new civil-date and wall-clock column takes `civilDateShape` / `wallClockTimeShape` from `packages/database/src/date-shape-checks.ts`, per the standing rule that the only classification open to a new date column is the guard.

### 7.1 `booking_page` and `booking_page_hours`

```
booking_page
  id                        text pk            -- bookingPage_ handle
  owner_user_id             text not null -> member.user_id
  name                      text not null      -- the heading a visitor reads and the booked event's title; 1..120
  description               text null          -- public; <= 1000
  medium                    text not null      -- 'video' | 'audio'  (CHECK)
  duration_minutes          integer not null   -- CHECK 10..240
  slot_step_minutes         integer not null   -- CHECK IN (5, 10, 15, 20, 30, 60)
  buffer_before_minutes     integer not null default 0     -- CHECK 0..120
  buffer_after_minutes      integer not null default 0     -- CHECK 0..120
  minimum_notice_minutes    integer not null default 240   -- CHECK 0..20160
  maximum_days_ahead        integer not null default 30    -- CHECK 1..90
  maximum_per_day           integer null                   -- CHECK NULL OR 1..24
  time_zone                 text not null      -- IANA; the zone the hours are read in and the event is recorded in
  event_type_id             text null -> matter_event_type.id   -- a firm-category type, checked by the service
  status                    text not null default 'draft'  -- 'draft' | 'published' | 'retired'  (CHECK)
  address_version           integer not null default 1     -- CHECK >= 1
  published_at              text null          -- instant
  retired_at                text null          -- instant
  created_at, updated_at
  CHECK length(time_zone) > 0; CHECK length(name) BETWEEN 1 AND 120
  CHECK (status = 'retired') = (retired_at IS NOT NULL)
  INDEX (owner_user_id, status)

booking_page_hours
  id                        text pk            -- bookingPageHours_ handle
  booking_page_id           text not null -> booking_page.id
  weekday                   text not null      -- 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'  (CHECK)
  starts_at_time            text not null      -- wall clock; wallClockTimeShape
  ends_at_time              text not null      -- wall clock; wallClockTimeShape
  created_at
  CHECK ends_at_time > starts_at_time
  INDEX (booking_page_id, weekday)
```

The weekday is the recurrence grammar's own code (`WEEKDAY_CODES`, `weekdayOf` in `@magna-carta/civil-time/recurrence`), not a number, so there is one spelling of a weekday in the product. **A window never crosses midnight**: "Monday 22:00 to 02:00" is two windows, Monday 22:00–24:00 is not expressible either, and a night-shift page is out of scope (section 14). The service refuses a zone `isResolvableTimeZone` refuses, and hours are replaced as a set on an edit, the event participants' replace-set idiom.

### 7.2 `booking_appointment`

```
booking_appointment
  id                        text pk            -- bookingAppointment_ handle
  booking_page_id           text not null -> booking_page.id
  owner_user_id             text not null -> member.user_id    -- the page's owner at the hold; whose time this is
  state                     text not null      -- 'held' | 'confirmed' | 'cancelled' | 'lapsed'  (CHECK)
  starts_at                 text not null      -- instant
  ends_at                   text not null      -- instant
  blocked_from              text not null      -- instant: starts_at less the page's buffer before, at the write
  blocked_until             text not null      -- instant: ends_at plus the page's buffer after, at the write
  starts_on_in_page_zone    text not null      -- civil date; civilDateShape; what the per-day ceiling counts
  visitor_name              text not null      -- as typed and normalized; <= 80
  visitor_email             text null          -- as typed; only while held; null once confirmed or lapsed
  visitor_address_key       text null          -- HMAC-SHA-256 of the normalized address; the per-address bound
  visitor_time_zone         text not null      -- IANA, as the visitor's browser reported and they confirmed
  token_secret_hash         text not null      -- SHA-256 of the appointment link's secret, hex
  secret_version            integer not null default 1
  hold_expires_at           text not null      -- instant
  entity_id                 text null          -- directoryPerson_ handle, by value; set at confirmation
  directory_email_id        text null          -- the contact point matched or created
  directory_match           text null          -- 'matched' | 'created' | 'created-ambiguous'  (CHECK)
  firm_event_id             text null -> firm_event.id
  meeting_id                text null -> meeting.id
  confirmed_at              text null
  reschedule_count          integer not null default 0     -- CHECK 0..3
  cancelled_at              text null
  cancelled_by              text null          -- 'visitor' | 'member'  (CHECK)
  cancelled_by_user_id      text null -> member.user_id
  reviewed_at               text null
  reviewed_by_user_id       text null -> member.user_id
  review_outcome            text null          -- 'kept' | 'merged' | 'discarded'  (CHECK)
  created_at, updated_at
  CHECK ends_at > starts_at; CHECK blocked_from <= starts_at; CHECK blocked_until >= ends_at
  CHECK state = 'held'      -> visitor_email IS NOT NULL AND entity_id IS NULL AND firm_event_id IS NULL
  CHECK state = 'confirmed' -> entity_id, directory_match, firm_event_id, meeting_id, confirmed_at all NOT NULL
  CHECK (state = 'cancelled') = (cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)
  CHECK (cancelled_by = 'member') = (cancelled_by_user_id IS NOT NULL)
  CHECK reviewed_at, reviewed_by_user_id, review_outcome all set or all null
  INDEX (owner_user_id, starts_at)                                          -- the overlap guard; "my appointments"
  INDEX (booking_page_id, starts_on_in_page_zone) WHERE state IN ('held', 'confirmed')  -- the per-day ceiling
  INDEX (visitor_address_key, created_at) WHERE visitor_address_key IS NOT NULL         -- the per-address bound
  INDEX (hold_expires_at) WHERE state = 'held'                              -- the lapse sweep
  INDEX (owner_user_id, confirmed_at) WHERE state = 'confirmed' AND reviewed_at IS NULL -- the review queue
  UNIQUE (firm_event_id) WHERE firm_event_id IS NOT NULL                    -- one appointment per event
```

`blocked_from` and `blocked_until` are stored rather than computed in SQL because SQLite cannot add minutes to an instant held as text, and the guard below has to compare them in the statement's own WHERE. They are written at the hold and rewritten by the two paths that move an appointment, and nowhere else. `starts_at` and `ends_at` of a confirmed appointment equal the instants its event resolves to, kept so by the same two paths; a test asserts the pair after every move.

**The address is never kept twice.** While held, it has no other home, so the row carries it; at confirmation it moves to the Directory (a matched row, or a new verified one) and the column is blanked in the same batch; at lapse it is blanked. `visitor_address_key` survives for the bound's one day and is blanked by the daily pass after that — it is a keyed hash (the key is `AUTH_SECRET`) so the table never holds a list of addresses that could be read back by hashing guesses.

### 7.3 The guarded hold

The hold is `INSERT … SELECT … WHERE` with every bound in its own predicate, wrapped in `guarded(…)` so a refusal is a named guard rather than a constraint error, and so two visitors pressing Hold on the same time in the same instant end with one hold — the check and the write are one statement:

- **No live appointment of the owner's overlaps**, by the two-sided rule of section 6.2 condition 5, where live means `state = 'confirmed' OR (state = 'held' AND hold_expires_at > :now)`. Guard `appointment.slot` → `appointment-time-taken` (409).
- **The page's per-day ceiling** is not reached on `starts_on_in_page_zone`. Same guard, same refusal: to the visitor, a full day and a taken time are the same fact.
- **Fewer than `MAX_LIVE_HOLDS_PER_PAGE = 20` live holds** on the page. Guard `appointment.holds` → `booking-page-busy` (429 with a retry window of `BOOKING_HOLD_MINUTES`).
- **Fewer than `MAX_HOLDS_PER_ADDRESS_PER_DAY = 3`** rows with this `visitor_address_key` created in the last day, across every page in the firm. Same guard as above.

The calendar busy read is not in the statement — it crosses zones, which SQL cannot — so it is re-read at the hold and at the confirmation, and a member's own entry added in between is simply what the confirmation finds.

### 7.4 `meeting_reminder`

```
meeting_reminder
  id                        text pk            -- meetingReminder_ handle
  meeting_id                text not null -> meeting.id
  purpose                   text not null      -- 'invitation' | 'day-before' | 'quarter-hour'  (CHECK)
  recipient_kind            text not null      -- 'member' | 'guest'  (CHECK)
  recipient_id              text not null      -- a user id or a Directory entity handle, BY VALUE, no foreign key
  event_starts_at           text not null      -- instant the row was computed from
  due_at                    text not null      -- instant
  state                     text not null default 'pending'  -- 'pending' | 'sent' | 'withdrawn' | 'failed'  (CHECK)
  withdrawn_reason          text null          -- 'rescheduled' | 'cancelled' | 'ended' | 'participant-removed' | 'late'  (CHECK)
  attempt_count             integer not null default 0       -- CHECK 0..3
  failure_error_id          text null          -- the standard pipeline's Error ID, where state = 'failed'
  settled_at                text null          -- instant
  created_at, updated_at
  CHECK purpose <> 'invitation' OR recipient_kind = 'guest'
  CHECK (state = 'withdrawn') = (withdrawn_reason IS NOT NULL)
  CHECK (state = 'pending') = (settled_at IS NULL)
  CHECK (state = 'failed') = (failure_error_id IS NOT NULL)
  UNIQUE (meeting_id, recipient_id, purpose, event_starts_at)
  INDEX (due_at, id) WHERE state = 'pending'                    -- the pass and the re-arm
  INDEX (meeting_id, state)                                      -- withdrawal on move, cancel and removal
```

The recipient is carried by value for the reason `meeting_message.participant_id` is: the row is about a person in one of two tables, and the house idiom for that (the `matter_party` precedent) is no cross-domain foreign key. **The UNIQUE index is the convergence** — `(meeting, person, purpose, start)` is sent at most once, overlapping passes and a clock that fired twice included — and it is on a row this subsystem keeps, never on `notification_event.dedupe_key`, which the retention sweep deletes (`docs/decisions/pending/a-dedupe-key-is-bounded-by-the-retention-window.md`). A reminder moved to a new start is a new key, which is exactly right: the day-before reminder for the new Tuesday has not been sent.

### 7.5 Identifiers, personal data, audit

Identifiers `bookingPage`, `bookingPageHours`, `bookingAppointment`, `meetingReminder` in `packages/identifiers` (types and registry).

Personal-data registry (`packages/data-access/src/pii-registry.ts`): `booking_appointment.entity_id` and `visitor_name` are `retain-under-matter`, on the guests design's reasoning that who met the firm is part of what the calendar record says happened; `booking_appointment.owner_user_id`, `cancelled_by_user_id`, `reviewed_by_user_id`, `booking_page.owner_user_id` are `pseudonymize-keep`; `meeting_reminder.recipient_id` is `retain-under-matter`, as a record of what the platform sent in the firm's name. `visitor_email` has no subject anchor while it is set — the person does not exist yet — which is why it is bounded by lapse and confirmation rather than by erasure, and the registry note says so.

Audit rows through `domainAuditStatement`, identifiers and instants only: `meetings.bookingPage.created`, `.updated`, `.published`, `.addressRotated`, `.retired`; `meetings.appointment.held`, `.confirmed`, `.rescheduled`, `.cancelled`, `.lapsed`, `.reviewed`. Never a name, an address, a zone the visitor typed, a token or a secret. Reminder sends are not audited one by one — the reminder row is the record, as `invoice_reminder` is.

## 8. Routes

### 8.1 The public lane (`apps/api-worker/src/routes/booking-visitor.ts`)

| method | path                                | lane          | does                                                                                                                                                     |
| ------ | ----------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/v1/booking/page`              | `page`        | the public summary; writes nothing                                                                                                                       |
| `GET`  | `/api/v1/booking/page/slots`        | `page`        | `from`, `to` instants, window at most fifteen days; `{ slots: [{ startsAt, endsAt }], truncated }`                                                       |
| `POST` | `/api/v1/booking/holds`             | `page`        | body `{ startsAt, givenName, familyName?, email, timeZone }`; human verification; idempotency required; 201 `{ startsAt, endsAt, holdExpiresAt }`; mails |
| `GET`  | `/api/v1/booking/appointment`       | `appointment` | the appointment as the visitor may know it; writes nothing, spends nothing                                                                               |
| `GET`  | `/api/v1/booking/appointment/slots` | `appointment` | the page's slots for a move, with this appointment's own time not counting against it                                                                    |
| `POST` | `/api/v1/booking/confirmation`      | `appointment` | idempotency required; confirms (section 5.3); 200 with the appointment; mails                                                                            |
| `POST` | `/api/v1/booking/rescheduling`      | `appointment` | body `{ startsAt }`; idempotency required; mails                                                                                                         |
| `POST` | `/api/v1/booking/cancellation`      | `appointment` | idempotency required; mails                                                                                                                              |

**No route carries an identifier in the path.** The page and the appointment are facts of the credential, as the meeting is a fact of a guest's. The shapes are distinct schemas with nothing that names a matter, an event, a meeting, a member's user id or a Directory handle:

- `BookingPagePublicSummary`: `{ firmName, memberName, name, description, medium, durationMinutes, timeZone, maximumDaysAhead }`.
- `BookingAppointmentForVisitor`: `{ firmName, memberName, pageName, medium, startsAt, endsAt, pageTimeZone, visitorTimeZone, state, holdExpiresAt, canReschedule, canCancel, joinLink: "sent" | "scheduled" | "not-yet", joinLinkSendsOn }` — the link itself is never in a response; it travels only by mail.

Refusals: `appointment-time-taken` (409, with the sentence _"Somebody took that time a moment ago. Here are the times still open."_), `booking-page-busy` (429), `booking-page-unavailable` (410), `appointment-hold-lapsed` (410), `appointment-cancelled` (410), `appointment-not-changeable` (409: inside the notice, or the move limit reached), `meeting-in-progress` (409, reused), `slot-window-too-wide` (422), `time-zone-not-resolvable` (422), `human-verification-refused` (the gate's own 403 and 503).

### 8.2 The member's routes (`apps/api-worker/src/routes/booking-pages.ts`)

| method  | path                                                         | permission                     | does                                                                                                                   |
| ------- | ------------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `GET`   | `/api/v1/booking-pages`                                      | `meetings:publishBookingPages` | the caller's own pages, cursor-paged                                                                                   |
| `POST`  | `/api/v1/booking-pages`                                      | `meetings:publishBookingPages` | create a draft; 201                                                                                                    |
| `GET`   | `/api/v1/booking-pages/{bookingPageId}`                      | `meetings:publishBookingPages` | one of the caller's pages, with its hours and, when published, its `address`                                           |
| `PATCH` | `/api/v1/booking-pages/{bookingPageId}`                      | `meetings:publishBookingPages` | the rules; `hours` replaces the set where supplied                                                                     |
| `POST`  | `/api/v1/booking-pages/{bookingPageId}/publication`          | `meetings:publishBookingPages` | publish; refused 409 `booking-pages-disabled` while the firm's switch is off, 403 without the other keys               |
| `POST`  | `/api/v1/booking-pages/{bookingPageId}/address-rotation`     | `meetings:publishBookingPages` | a new address; every old one refuses                                                                                   |
| `POST`  | `/api/v1/booking-pages/{bookingPageId}/retirement`           | `meetings:publishBookingPages` | retire; appointments on it stand                                                                                       |
| `GET`   | `/api/v1/booking-pages/{bookingPageId}/slots`                | `meetings:publishBookingPages` | the preview: the same computation and shape a visitor gets                                                             |
| `GET`   | `/api/v1/booking-appointments`                               | `meetings:publishBookingPages` | the caller's appointments; `scope` = `upcoming` \| `past` \| `review`, cursor-paged                                    |
| `POST`  | `/api/v1/booking-appointments/{bookingAppointmentId}/review` | `meetings:publishBookingPages` | body `{ outcome: "kept" \| "merged" \| "discarded", survivingEntityId? }`; merge also checks the Directory's merge key |
| `GET`   | `/api/v1/meetings/policy`                                    | `firm:manageMeetingPolicy`     | `{ bookingPagesEnabled }`                                                                                              |
| `PUT`   | `/api/v1/meetings/policy`                                    | `firm:manageMeetingPolicy`     | set it; turning it off makes every page answer unavailable at once and changes no appointment                          |

Every page and appointment route is scoped to the **session's** user: another member's page is not found rather than forbidden, the notifications subsystem's rule for a row that belongs to somebody else. The policy routes live in `apps/api-worker/src/routes/meeting-policy.ts`, on the precedent of the other `firm:manage…Policy` pairs. Two new keys in `packages/access-control/src/registry.ts`, both `resource: "firm"`: `meetings:publishBookingPages` ("publish booking pages of one's own and review the appointments taken on them"), seeded to no default role — a firm decides who may put a page on the internet in its name — and `firm:manageMeetingPolicy`, seeded where the other policy keys are.

### 8.3 What changes on the calendar routes (`apps/api-worker/src/routes/calendar.ts`)

- **`POST /api/v1/matters/{matterId}/events`, `POST /api/v1/firm-events`**: invitable Directory participants are invited or deferred in the batch (section 3.2); reminders planned; the response gains `guestInvitations`.
- **`PATCH /api/v1/events/{eventId}`, `PATCH /api/v1/firm-events/{firmEventId}`**: a timing change re-plans reminders, reissues or defers guest links, and moves the event's appointment; a participant change invites added Directory people, revokes removed ones' links, and reconciles reminders. The response gains `guestInvitations` for what the edit sent.
- **`POST /api/v1/events/{eventId}/cancel`, `POST /api/v1/firm-events/{firmEventId}/cancel`**: withdraws reminders and cancels the event's appointment in the same batch; mails guests and the visitor after the commit.

All of it is composed through `@magna-carta/meetings` functions the route calls, and none of it is new logic in the route file: the route's part is what it already does for the room — decide what the request asked, compose, commit, then send.

## 9. The appointment lane at the chokepoint

`RouteMeta` gains **`bookingLane?: "page" | "appointment"`**, beside `guestLane` and on its terms: absent on every other route, and refused at registration unless the route also declares `authenticated: false`, `permission: null`, `surface: "app"`, `resource: "firm"` — and never together with `guestLane`.

At request time it is step zero, instead of steps one to three, for a route that declared it:

1. **Read the credential** from its own header — `x-booking-page` for the page lane, `x-booking-appointment` for the appointment lane. No query parameter is accepted on any route: there is no socket on this lane, so the one reason the guest lane has for reading an address does not arise.
2. **No credential, a signature that does not verify, the wrong `typ`, or an expired appointment token** — the reserved 404, after spending the limiter keyed by the client address, as the guest lane's flat refusal does. Nothing is read.
3. **Resolve the firm context** through a port method of its own, `resolveBookingFirmContext` — not the guest method and not `resolveFirmContext`, for the guest design's reason that two methods cannot be confused where one with a flag can.
4. **Confirm the credential is live.** For a page: the row exists, is `published`, its `address_version` equals the token's, the firm's switch is on, and the owner is an active member holding the keys of section 5.1. For an appointment: the row exists, its `secret_version` matches, the SHA-256 of the presented secret matches the stored hash under a constant-time comparison, and it is not `lapsed`. **Any page failure is one answer, `booking-page-unavailable`** (410, _"This booking page is not taking appointments. Contact the firm directly."_): the address is public and anybody may hold it, so the answer says the page is closed and never says why — not whether the member left, lost a key, or the firm turned pages off. Appointment failures are specific, because only the person whose mailbox received the link can present a valid one.
5. **Stash `chokepointBookingCredential` (the page or appointment handle and version, never the secret), `chokepointFirmId`, `chokepointFirmContext`** — never `chokepointUserId`, never permissions. A member handler pointed at a lane route throws on its first `requireChokepointUserId`, which is the structural guarantee the guest lane already relies on.
6. **Continue into idempotency, rate limit and the handler, unchanged.** The rate-limit key is `booking:${bookingPageId}:${clientAddress}` on the page lane — per visitor per page, so one abusive client cannot spend the page's budget for everybody else — and `appointment:${bookingAppointmentId}` on the appointment lane.

A request carrying a booking credential to a route outside the lane gets the reserved absence before a session is looked for, the guest lane's other direction. The two lanes read only their own headers, and a request carrying the other lane's credential is refused on every route outside that lane by the same check.

New rate-limit buckets in `apps/api-worker/src/chokepoint/rate-limiter.ts`: `booking-read` (60 per 60 seconds; the summary and the slot reads), `booking-hold` (5 per 600 seconds; the hold, beneath the SQL bounds of section 7.3), `booking-act` (10 per 600 seconds; confirm, move, cancel, and the appointment reads).

**Tokens** (`apps/api-worker/src/meetings/booking-tokens.ts`, over `signed-token.ts`):

```
booking-page-address   { firmId, bookingPageId, addressVersion }                        -- no secret, no exp
booking-appointment    { firmId, bookingAppointmentId, secretVersion, secret, exp }     -- secret: 32 bytes, base64url
```

The appointment token's `exp` is the hold instant plus `maximum_days_ahead` plus seven days, a ceiling above anything the page can offer; the row's own state and `ends_at + APPOINTMENT_MANAGEMENT_GRACE_HOURS` (two) are what actually end it, so a move does not need a new token. The secret is minted through `@magna-carta/identifiers/random`, stored only as its SHA-256, and never reaches a log, a counter, a problem, an audit row, a telemetry field or the idempotency store.

## 10. Notifications and mail

### 10.1 Members, through the registry

Five new types in `packages/notifications/src/registry.ts`, all `raisedBy: "outbox-topic"`, category `calendar`, subscribing to topic constants exported from `packages/meetings/src/notification-topics.ts` so producer and subscriber share one spelling:

| type key                         | topic                              | subject kind      | audience                           | facts                      |
| -------------------------------- | ---------------------------------- | ----------------- | ---------------------------------- | -------------------------- |
| `meetings.appointment.booked`    | `meetings.appointment.confirmed`   | `directoryEntity` | `named-recipient` (`ownerUserId`)  | `medium`, `directoryMatch` |
| `meetings.appointment.moved`     | `meetings.appointment.rescheduled` | `directoryEntity` | `named-recipient` (`ownerUserId`)  | `medium`                   |
| `meetings.appointment.cancelled` | `meetings.appointment.cancelled`   | `directoryEntity` | `named-recipient` (`ownerUserId`)  | `medium`                   |
| `meetings.appointment.reminder`  | `meetings.appointment.reminderDue` | `directoryEntity` | `named-recipient` (`ownerUserId`)  | `medium`, `lead`           |
| `meetings.meeting.reminder`      | `meetings.meeting.reminderDue`     | `matterEvent`     | `named-recipient` (`memberUserId`) | `medium`, `lead`           |

The four appointment types point at **the visitor's Directory person**, `matterResolution: none`, with the deep link `/meetings/appointments?visitor=<subjectId>`. That is the subject kind the schema's CHECK already admits, and it is the right subject rather than a workaround: what the member has to do about a booking is look at who booked it, and the Appointments screen opens on that person's appointments with Join on the next. The appointment's own moves raise `moved` and `cancelled` only when the **visitor** made them; a member's own move through the calendar tells the member nothing, because they did it. The meeting reminder is matter-anchored through its payload, like `meetings.meeting.scheduled`. Payloads are identifiers, the closed labels, and the user id named — no title, no name, no time, on the registry's standing reasoning that a stored time is a stale time; the sentence a member reads is composed at the deep link from the live record.

Email reaches members only as the digest's counts, exactly as for every other type. No type here declares `escalation: "immediate"`, and none may: that is trust and security only.

### 10.2 People outside the firm, by direct mail

Sent through the `sendEmail` port after the commit that makes each true, each with its own `messageClass` so telemetry counts it without the body, each composed by a pure function in `apps/api-worker/src/meetings/booking-mail.ts` (visitors) or beside the guest invitation mail (guests):

| message class                   | to                   | carries                                                                                     |
| ------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `booking-appointment-hold`      | the typed address    | the firm, the member, the time in both zones, the appointment link and the typed fallback   |
| `booking-appointment-confirmed` | the visitor          | the time in both zones, the guest link or the date it will come, a pointer to the hold mail |
| `booking-appointment-moved`     | the visitor          | who moved it, the new time in both zones, a fresh guest link or its date                    |
| `booking-appointment-cancelled` | the visitor          | who cancelled it, the time that no longer stands                                            |
| `meeting-guest-announcement`    | a Directory guest    | the firm, the title, the start, the date the link will come                                 |
| `meeting-guest-moved`           | a Directory guest    | the new start, a fresh link or its date                                                     |
| `meeting-guest-cancelled`       | a Directory guest    | the start that no longer stands                                                             |
| `meeting-guest-reminder`        | any guest or visitor | the start, and a pointer to the mail that carried the link                                  |

**What a mail may carry about the firm's side** is the guests design's rule: the firm's name and the event's title because the member's own act discloses them, the member's name on a booking page because the member published it, and nothing about any matter. An appointment's title is the page heading, so its mails disclose nothing a visitor did not already read on the page.

**Every link goes to a screen that spends nothing on open**, and every mail with a link carries the bare token on its own line as the typed fallback. A mail to a visitor speaks in the visitor's zone and names the member's (section 5.7); a mail to a Directory guest speaks in the event's zone, labelled, as the invitation already does.

## 11. Security

### 11.1 The public surface

Three routes read and five write, and none of them is reachable without a credential this worker signed. The page address is not a secret, so its protection is not secrecy: it is that every request carrying anything else is refused before a read, and that what a valid address can do is bounded by the SQL bounds of section 7.3 and the buckets of section 9. **The hold is the one route that writes on the strength of a public address**, so it is the one behind the human-verification gate (`enforceHumanVerification`, called from the handler after the limiter, per that gate's own reasoning). The gate is dormant until a verifier credential is provisioned and the web has no widget that mints a solution yet — the joining screens share that gap (`apps/web/src/lib/auth/unbuilt-capabilities.ts`) — so until both land, the hold rests on the per-page, per-address and per-client bounds alone, and that is said here rather than implied.

### 11.2 What a page reveals

A slot list is, unavoidably, a coarse map of when a member is busy during their published hours. It is bounded to those hours, to the page's step, and to at most ninety days ahead, and it carries no reason a time is missing. A member who does not want that map published does not publish a page. The busy read returns two instants per entry and nothing else (section 6.3), so no title, type, matter or participant of anything on the member's calendar can reach the page by any path.

### 11.3 Abuse

- **Holding every slot.** Twenty live holds per page, three holds per address per day across the firm, five holds per client address per ten minutes, and fifteen minutes per hold: a single client can deny a page for minutes, not days, and cannot do it without a stream of distinct addresses that each cost them a mailbox.
- **Mailing a stranger.** The address bound caps how often one address can be sent a hold mail, and a hold mail commits the recipient to nothing.
- **Polluting the Directory.** Impossible without a mailbox the attacker controls, and every entry that arrives this way is `needs_review` and on its owner's review list with a Discard that takes it back out.
- **A forwarded appointment link.** It confirms, moves or cancels one appointment; it never admits anybody to the meeting, which is the guest link's job, and the guest link still ends at the lobby with the typed name beside the invited one.

### 11.4 The visitor's text

`givenName` and `familyName` are untrusted display text: normalized for whitespace with the guest name's rule (`normalizeGuestName`), bounded so the rendered name is at most eighty characters, rendered as text and never as markup. There is deliberately **no free-text field** on the page — no "what would you like to discuss". A prospective client's account of their problem, typed into a public form, would land on a firm event every member may read, which is the wrong record for confidential intake content (section 14). The email address is validated by the Directory's own address rule before anything is held.

### 11.5 Time zones as input

The visitor's zone is input like any other: refused if `isResolvableTimeZone` refuses it, never used to compute anything the member's side stores, and only ever used to phrase mail and the page. The event is recorded in the page's zone whatever the visitor said.

## 12. Testing

- **`packages/meetings/test/booking-slots.test.ts`** — the pure function: hours read in the page's zone across the spring and autumn changes (America/Los_Angeles and Europe/London, a window opening inside the gap, a window straddling the repeat keeping an even step); a page in Pacific/Honolulu whose "days ahead" boundary falls on a different UTC day; minimum notice at its edge; buffers on both sides, and two appointments' buffers not summed; touching slots offered; an all-day busy entry in America/New_York blocking a Los Angeles page from 21:00 the evening before; a timed entry with no end blocking its hour; a multi-day entry; the per-day ceiling counted in the page's days; two overlapping hours windows offering each time once; the 500 cap reporting `truncated`; an empty week offering nothing; results sorted and within the window.
- **`packages/meetings/test/reminder-plan.test.ts`** — the planned rows for members and guests; no lead written that has already passed; nothing for a recurring event or an `all_members` event; a deferred `invitation` row due at the first instant a link reaches the end; reconciliation on a move (old pending withdrawn, sent kept, new inserted), on a participant removed, on a cancel.
- **`packages/meetings/test/appointments.test.ts`** over `node:sqlite` — the guarded hold refuses an overlap, a full day, the twenty-first live hold and the fourth hold from one address, and two holds on one time in one instant end with one; a lapsed hold stops blocking; confirmation matches one person, creates a `needs_review` person with a verified email row when there is none, creates one beside the candidates when there are several, never matches an organization, and blanks `visitor_email` in the batch; the confirmation batch holds the event, both participants, the meeting, the host grant, the invitation (or the deferred row), the reminders and the appointment, or none of them; a move keeps the appointment's instants equal to its event's; the review's three outcomes, and Discard refused for a person somebody has since put on a matter.
- **`packages/calendar/test/member-busy.test.ts`** — the busy read and the federated member filter answer the same set of events over one fixture (the drift assertion); cancelled events excluded; a recurring series expanded with its exception skipped; no field beyond the two instants leaves it.
- **`apps/api-worker/test/booking-lane.test.ts`** — a route declaring `bookingLane` with a permission, `authenticated: true`, or `guestLane` beside it throws at registration; no credential, a bad signature and the wrong `typ` answer the reserved 404 with no firm read; a stale address version, a retired page, a page whose owner lost `meetings:host`, and a firm with the switch off all answer the same 410 body; `chokepointUserId` is never set and `loadPermissions` never runs on the lane; a booking credential on a member route answers the reserved 404; a guest credential on a booking route likewise.
- **`apps/api-worker/test/booking-visitor-routes.test.ts`** — the whole path against a fake mail port: the page read and the slot read write nothing; a hold mails once and a replay of its idempotency key mails nothing; the appointment read spends nothing; confirm, move and cancel; the move limit; cancel refused while the meeting is live; **no response body on the lane contains a matter, event, meeting, member or Directory handle, a token or a secret**, asserted over the bodies rather than the schemas; the stored idempotency bodies contain no token.
- **`apps/api-worker/test/booking-pages-routes.test.ts`** — another member's page is not found; publish refused with the switch off and without each key; rotation refuses the old address; the preview equals the public slot read for the same window.
- **`apps/api-worker/test/calendar-scheduling-guests.test.ts`** — an event saved with a meeting and two Directory people, one with an address and one without, answers `sent` and `not-invitable`; a far-out event answers `scheduled` and writes the deferred row; a move reissues the live link (the old one refuses at the guest lane) and mails; a move of a booked event moves its appointment and mails the visitor; a cancel withdraws reminders and cancels the appointment.
- **`apps/api-worker/test/meeting-reminder-clock.test.ts`** — against the real Durable Object in the test pool: `armFor` never moves the alarm later; a wake sends due guest reminders and settles member rows with their outbox message in one batch; a withdrawn, moved or late row is not sent; a failed send retries twice then settles `failed` with an Error ID; an unprovisioned mail port sends and marks nothing; every wake re-arms from the table; the daily backstop arms a firm whose arm was lost.
- **Mail** — each message class renders the time in the visitor's zone and the member's, carries the link only where the table says it does, and contains no matter identifier; `apps/api-worker/test/joining-mail.test.ts` is the template.
- **Notifications** — `test/registry-fitness.test.ts` passes with the five types; the appointment types are not matter-anchored and reach one member by declaration.
- **Contract** — the emitted OpenAPI and the generated client regenerated in the same commit; the conformance suite's operation list updated; the two public shapes asserted distinct from every member-facing schema.
- **`apps/web`** — `visitor-slot-days.test.ts` groups instants into the visitor's days (a Tokyo visitor sees a Pacific Tuesday evening under Wednesday); `booking-page-draft.test.ts` for the page's shortfalls (a window ending before it starts, an unresolvable zone, a duration longer than every window); `meeting-guest-reach.test.ts` for which Directory people the form says will and will not be sent a link; the visitor pages against a fake transport: the page opens with no write, the hold states the fifteen minutes, the manage page confirms, moves and cancels.
- **Load profile** — the busy read and the slot computation over a member with a dense year (five hundred timed entries, forty recurring series, a fifteen-day window), asserted at two statements per slot read.

## 13. The file-touch list

**This slice sequences after the guests slice lands, both halves.** It composes guest invitations from inside the calendar's batch, reissues them on a move and extends the chokepoint beside the guest lane, so starting before `guest-service.ts`, `route-meta.ts` and `chokepoint.ts` settle would be a merge about the guest lane rather than about scheduling.

**The shared surface is `apps/api-worker/src/contracts/route-meta.ts` and `apps/api-worker/src/chokepoint/`**, as it was for the guests. The booking lane is additive and inert for a route that does not declare it, and it lands in **one commit of its own, first**.

**Backend agent**

- `packages/identifiers/src/registry.ts`, `src/types.ts` — `bookingPage`, `bookingPageHours`, `bookingAppointment`, `meetingReminder`.
- `packages/database/src/per-firm-schema.ts`, one new migration under `packages/database/drizzle/per-firm/`, its snapshot and `meta/_journal.json`; `pnpm run migration-bundles` in the same commit. Four tables, nothing altered.
- `packages/data-access/src/pii-registry.ts` — section 7.5.
- `packages/access-control/src/registry.ts` — `meetings:publishBookingPages`, `firm:manageMeetingPolicy`, and their role seeding where that registry declares it.
- `packages/civil-time` — nothing; every function this needs exists.
- `packages/calendar/src/member-busy.ts` — **new**; `packages/calendar/src/sources/all.ts` — the two member predicates factored into exported fragments.
- `packages/directory/src/person.ts`, `src/statements.ts` — `needsReview` on the person compose, `discardProvisionalPerson` and its statement.
- `packages/meetings/src/booking-types.ts`, `booking-slots.ts`, `booking-statements.ts`, `booking-service.ts`, `booking-validation.ts` — **new**; the page, the appointment, the guarded hold, confirmation, move, cancel, review.
- `packages/meetings/src/reminder-types.ts`, `reminder-plan.ts`, `reminder-statements.ts`, `reminder-service.ts` — **new**.
- `packages/meetings/src/notification-topics.ts`, `booking-settings.ts` — **new**; the five topics, the firm setting definition.
- `packages/meetings/src/guest-service.ts`, `guest-statements.ts` — `composeGuestInvitation`, `composeGuestLinkReissue`.
- `packages/meetings/package.json` — the new export paths.
- `packages/notifications/src/registry.ts` — the five types.
- `packages/telemetry/src/events.ts` — the lane's refusals, the hold bounds, the reminder pass's sends, failures, withdrawals and unprovisioned exits.
- `apps/api-worker/src/contracts/route-meta.ts`, `src/chokepoint/chokepoint.ts`, `ports.ts`, `context-accessors.ts`, `rate-limiter.ts` — **the shared surface, first commit**: `bookingLane`, its registration guards, `BookingLanePort`, `requireChokepointBookingCredential`, the three buckets.
- `apps/api-worker/src/contracts/problem-types.ts` — the refusals of section 8.1.
- `apps/api-worker/src/meetings/booking-tokens.ts`, `booking-lane.ts`, `booking-mail.ts` — **new**.
- `apps/api-worker/src/meetings/guest-invitation-mail.ts` — the announcement, moved, cancelled and reminder texts beside the invitation.
- `apps/api-worker/src/meetings/reminders/reminder-clock.ts`, `reminder-pass.ts`, `reminder-send-port.ts` — **new**; the Durable Object, the pass, and the port that answers unavailable rather than logging.
- `apps/api-worker/src/routes/booking-visitor.ts`, `booking-pages.ts`, `meeting-policy.ts` — **new**.
- `apps/api-worker/src/routes/calendar.ts` — section 8.3.
- `apps/api-worker/src/app.ts` (the binding type and route registration), `src/index.ts` (the Durable Object export), `wrangler.jsonc` (the binding and its migration entry), `src/event-dispatch.ts` and `src/scheduled.ts` (the daily lapse sweep, the address-key blanking and the clock backstop).
- `apps/api-worker/openapi/openapi.json` and `packages/api-client` — regenerated, never hand-edited.
- `apps/api-worker/test/*` and `packages/*/test/*` of section 12.
- `roadmap.d/meetings.md` (`meetings.scheduling.booking-pages` to `designed` with this spec, then `in-build`, then `shipped`; `meetings.scheduling` and `meetings.scheduling.from-the-calendar` notes updated for Directory invitations and reminders), `pnpm exec vp run register-build`, `status.d/`, `vp run status-build`, `changelog.d/<slug>.md`, and `docs/decisions/pending/` for three decisions: the appointment lane, the reminder clock with its table as the schedule, and "a visitor proves a mailbox before becoming anybody".

**Web agent**

- `apps/web/src/lib/calendar/event-draft.ts` — the two sentences of section 3.2 and the note under a repeating meeting.
- `apps/web/src/lib/calendar/meeting-guest-reach.ts` — **new**, pure: which Directory people on a draft will be sent a link and which cannot be.
- `apps/web/src/lib/calendar/meeting-guest-reach.svelte` — **new**; the line on the Who tab.
- `apps/web/src/lib/calendar/record-event-dialog.svelte` — renders the reach line and the `guestInvitations` outcomes after a save.
- `apps/web/src/lib/calendar/calendar-api.ts` — the widened create and update responses.
- `apps/web/src/lib/meetings/booking/booking-pages-api.ts`, `booking-page-draft.ts`, `booking-page-form.svelte`, `booking-hours-field.svelte`, `booking-page-preview.svelte` — **new**; the member's pages. The zone field is the calendar's `time-zone-picker.svelte`, reused.
- `apps/web/src/lib/meetings/booking/appointments-api.ts`, `appointment-list.svelte`, `appointment-review.svelte` — **new**; the Appointments screen and its review.
- `apps/web/src/lib/meetings/booking/visitor-api.ts`, `visitor-slot-days.ts`, `visitor-slot-picker.svelte`, `visitor-details-form.svelte`, `visitor-appointment.svelte` — **new**; the public side, which imports nothing from the application shell.
- `apps/web/src/routes/(app)/meetings/booking-pages/+page.svelte`, `+page.ts`, `[id]/+page.svelte`, `[id]/+page.ts` — **new**.
- `apps/web/src/routes/(app)/meetings/appointments/+page.svelte`, `+page.ts` — **new**.
- `apps/web/src/routes/(app)/meetings/+page.svelte` — the two entrances to the screens above.
- `apps/web/src/routes/(app)/settings/meetings/+page.svelte`, `+page.ts` — **new**; `apps/web/src/routes/(app)/settings/+layout.svelte` — its entry.
- `apps/web/src/routes/book/[address]/+page.svelte`, `+page.ts`, `apps/web/src/routes/book/manage/[token]/+page.svelte`, `+page.ts` — **new**, outside `(app)`.
- `apps/web/test/*` of section 12.
- `docs/user/features/meetings.md` — scheduling with people outside the firm, reminders, booking pages, and the review; the guide is where a member learns that a page is public and what it shows.

## 14. What this does not settle

- **A human-readable address** for a page (`/book/<firm>/<member>`): a control-plane name table read on every request, and a first-come namespace across firms.
- **A note from the visitor, or intake questions on the page.** Where confidential content typed by a prospective client may live is the intake procedure's question, and the answer is not a firm event every member can read.
- **Who may see that a booked appointment exists.** A firm event is readable by every member by construction, so a prospective client's name as a participant is visible firm-wide. Whether booked appointments need a narrower audience is the personal-appointment privacy question the firm-event schema already declines to answer.
- **Instant booking** without the mailbox step, as a per-page choice.
- **A member notification for a firm meeting with no visitor on it**, and member reminders for one: both wait on `notification_event.subject_kind` gaining `firmEvent`, which is a sequenced rebuild.
- **Reminders for recurring meetings**, and configurable reminder leads.
- **Working hours as a member's own setting** shared across pages, a night window crossing midnight, and a page offering hours in more than one zone.
- **Team pages**: a page owned by several members, round-robin assignment, or an administrator managing another member's page; and what becomes of the host of an appointment whose member has left.
- **Payment at booking**, which waits on the payments rail.
- **Starting a conflicts check** automatically for a booked stranger.
- **External calendars as busy** (a member's Google or Outlook calendar blocking their page), which waits on the calendar plugin.
- **A visitor who lost their mail.** The member reissues the guest link from the Guests panel, which mails it; a self-service "send it again" is refused here because anybody could make it rotate somebody else's link.
- **The Who tab's availability line across zones** (section 3.3), which keeps the grid's civil comparison.
- **A widget that mints a human-verification solution**, which this page and the joining screens both lack.
- **SMS reminders**, which wait on the communications layer's messaging port.
- **Desktop.** Parity holds: the member's screens are the web application's, the visitor's pages are web pages opened from a mail, and the desktop shell adds nothing to either.
