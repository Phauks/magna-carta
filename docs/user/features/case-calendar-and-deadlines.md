# Case calendar and deadlines

_The firm calendar, the matter's Calendar section, the room grid and the Home card are live. A matter's whole history is its [Activity section](matter-activity.md)._

## What it does

Two things that sound like one and are not.

**A record of what has happened on a case**, and what is coming. The matter's timeline pulls together
everything the firm has already recorded about that case — documents filed, email captured, documents
assembled, originals moved in and out of the safe, client money moved through trust, time and costs
booked, conflicts checks run, the matter opened and closed — and puts it in one order, alongside the
hearings, filings, and deadlines you record here. Nothing is copied to build that list: each entry is
read from the record it belongs to, so the timeline can never quietly disagree with the register,
the ledger, or the file it came from.

**A place to record the litigation itself**, which the platform has no other way to know about.
Hearings, filings, service, orders, depositions, mediations, trials, client meetings, site visits —
and separately, the dates you must act by.

## The calendar screens

**Calendar**, in the sidebar, is the firm's calendar. It opens on the whole firm's month: every
setting and deadline on every matter you can see, and the firm's own events beside them.

- **Mine, Everyone, or a colleague.** Mine narrows the month to what is on your own calendar:
  settings you are a participant at or the responsible attorney for, and every firm event whose
  audience is everyone. The colleague picker beside the pair reads one colleague's calendar the
  same way, over the matters you can see. The address remembers the choice, so a link you send
  opens the same way.
- **Custody dates.** Press it to add the safe custody register's dates to the calendar: when an
  original checked out is due back, and when a packet or an item is due for review. Each shows its
  custody number and opens the register. Off unless you turn it on, and the address remembers.
- **Hide settled.** On the agenda, press it to leave out what is no longer coming: cancelled
  settings and satisfied, vacated or superseded deadlines. The agenda says how many it left out.
  The month and the week always show them, struck through.
- **Month, week, agenda.** Three views of the same calendar. The month grid shows a few entries per
  day and says how many more there are; press that and the agenda opens on that day. The week is
  seven days side by side with each day's entries listed. The agenda is a fortnight as a list. The
  view and the date live in the address. The week begins on the day your firm chose, Sunday unless
  an administrator changed it under Settings › Calendar; it is the firm's setting rather than a
  personal one, so everybody in the firm reads the same week
  ([the administrator's guide](../admin/calendar-week-start.md)).
- **What an entry says on the firm calendar.** The kind and the matter, never the title: "Hearing,
  2026-0042". A calendar that spans every case does not broadcast what each case is about. Press
  the entry and it opens with its title, its people, its place and the zone its time is read in.
  Deadlines are the exception: they show their titles, because a deadline is read per matter you
  can see, and they say when they are past due.
- **Cancelled settings stay on the calendar, struck through.** A setting that was called off and one
  that never existed are different facts.
- **Record** at the top right records an event on a matter, a deadline on a matter, or a firm event.

**A matter's Calendar section** keeps its two tables (Deadlines, then Events) as the **List** view and
adds **Month** and **Agenda** beside them, which are the firm calendar narrowed to this one matter
and showing titles. **Record a deadline** and **Record an event** are on the section's own row.

**Two cards read the same calendar.** **Today** on Home is what is on your own calendar today and
tomorrow, six entries deep, with a line to the rest. **Coming up** on a matter's Overview is that
matter's next thirty days, six entries deep, with a line to its Calendar section. Neither is a
second calendar: press an entry on either and it opens the same window.

**Opening an entry.** Every entry opens in the same window: the record on the left, its people, its
links and its history on the right, and the verbs it allows along the bottom. Edit changes the
record in place. A scheduled setting can be **cancelled** with a reason or **continued**; an open
deadline can be **satisfied**, **vacated** with a reason, or **superseded** by a new one. A verb the
record's state or your permissions refuse stays visible and says why.

**Related settings.** Open an event and press **Relate** to link it to another setting on the same
matter (or, for a firm event, to another firm event within six months), with a note on why they
belong together. The Links tab lists them by title and opens either; **Remove** takes a relation off
without touching either setting. A continuance is never related by hand: the record makes that link.

**Who is at an event.** When recording, pick a person from the firm, from the directory, or type a
name once for somebody who is neither, such as a judge or a court reporter; each can carry a role.

## Recording an event

An event is anything that happened or will happen in the case. Give it a title, a date, and the time
zone it happens in. Everything else is optional.

- **A time is optional, and that is deliberate.** Leave it off and the event is an all-day one, which
  is what a filing is. Put it on and the event sits at that time.
- **The time zone is the one the event happens in** — for a hearing, the court's. A Nevada firm
  appearing in a California court records a Los Angeles hearing, because that is where nine in the
  morning is nine in the morning. Nothing about your firm, the matter, or your office can work that
  out on its own, so you are asked.
- **A range is a range.** Set an end date for a three-day trial; leave it off for a point in time.
- **Where it is** is free text: a courtroom, a department number, an address. A courthouse is not one
  of your offices, so it is not picked from your office list.
- **The court's own case number** goes on the event as the court writes it.
- **Who is there** can be a member of your firm, a contact from your directory, or somebody who is
  neither — a judge, a court reporter, an interpreter, a witness. You are not made to create a
  directory contact for a judge you will never write to.

**Correcting a record and rescheduling reality are different acts, and there is a verb for each.**
Typed the 13th when the hearing was always on the 14th? Edit the event — the record misdescribed
reality, and fixing it is one change with the audit trail behind it. But when the court vacates a
setting and makes a new one, **continue** the event instead: both settings happened in the world,
and the record keeps both — see [Continuing a hearing](continuing-a-hearing.md). A hearing that
comes off entirely is **cancelled**, not deleted, with an optional note saying why — that it was
vacated is itself a fact about the case.

## Recording a deadline

A deadline is a different kind of record from an event, because two things are true of it that are
not true of a hearing: it can be **satisfied**, and it **came from somewhere**.

Give it a title, a date, and a time zone. Add a time if you know it — many filing deadlines are five
in the afternoon, and a deadline whose hour nobody wrote down is not treated as midnight. Write down
**the authority** it comes from in your own words: the rule, the statute, the order. That note is
what you or a colleague reads six months later when deciding whether the date is right.

If another event started the clock — the date of death, the date of service, the entry of an order —
link it. The link records what the deadline hangs off. It does not calculate anything, and moving
that event does not move the deadline.

### What the platform will not do, and why

**The platform does not calculate deadlines.** It does no business-day counting, keeps no
court-holiday calendar, adds no days for the method of service, and never recalculates one date
because another moved. This is a decision, not a missing feature.

Missed deadlines are the single largest source of malpractice claims, and that fact points the
opposite way from where people expect. A deadline the software worked out and got wrong is worse than
one it never offered, because it will be trusted **precisely because** it was computed — and the
person who would have looked the rule up will not. Court rules are jurisdiction-specific, change, and
interact; a rule set that is ninety per cent right is not a help.

What the platform does instead is make every deadline **visible**: on the matter, on the firm-wide
list, and on the list of what is coming — with who recorded it and on what stated authority.

If a verified, jurisdiction-checked rule is ever encoded, it will **propose** a date and a person
will confirm it. The confirmation is what creates the record. It will never create one by itself, and
a rule that changes later will never move a date you already accepted — it will raise it for review.

### Satisfying, vacating, superseding

- **Satisfy** it when the firm has done the thing. Record the filing that discharged it if there is
  one; that is what turns "we did it" into "here is the thing we did".
- **Vacate** it when it is no longer in force — and say why. The reason is required, because "why is
  this deadline gone" is the question somebody asks much later and the only bad answer is silence.
- **Supersede** it when a new deadline replaces it. Both stay on the record and the old one names the
  new.

A settled deadline is never edited or re-decided. Record a new one that supersedes it — and if
somebody settles a deadline while you have it open for editing, your edit is refused rather than
quietly rewriting a deadline the firm has already dealt with.

## Overdue

A deadline that is still open and whose date and time have passed is shown as **overdue**, worked out
in that deadline's own time zone every time you look. Filtering a list to the overdue ones asks the
same question of every row, so a deadline due today in a Pacific court is not on that list at nine in
the morning — it is due at the end of its own day, in its own zone, not at midnight somewhere else. A
deadline with no time recorded is due at the end of the day it names.

Nothing anywhere records that your firm missed something. There is no flag, no nightly job, and no
status that changes on its own. The platform reports what it can see and does not draw a conclusion —
the deadline may have been extended by a stipulation nobody has typed in yet, met by a filing recorded
somewhere else, or vacated by an order that arrived this morning.

## Event types

Events are classified from a starting list — hearing, trial, filing, service, order entered, judgment
entered, deposition, mediation, arbitration, settlement conference, status conference, discovery
cut-off, appeal filed, notice received, plus client meeting, site visit, and call.

That list is a starting vocabulary and not a claim about how any court works. Add your own types for
whatever your practice sees, and retire the ones you never use — anything already classified under a
retired type keeps its meaning. The shipped types can be retired or regrouped but not renamed, so
"Hearing" means the same thing everywhere.

## Tips and edge cases

- **The firm-wide calendar asks for a date range, and it is capped at a year.** Ask for more and you
  are told so rather than quietly given less — a short answer that looks like a complete one is worse
  than an error.
- **Time and costs are on the timeline, and there are a lot of them.** They are the densest records a
  firm keeps. Filter them out when you want the shape of the case rather than every six minutes of it.
- **A timeline entry is a pointer, not a copy.** It says what happened and when, and links to the
  record itself — email subject lines, document names, narratives, and people's names stay behind that
  link and out of any list that spans several matters.
- **Reading the calendar and setting dates on it are separate permissions.** Everyone can see what is
  coming; asserting when a hearing is, is its own capability. A record control you cannot use stays
  on the screen, disabled, and says which permission it needs.
- **A month never asks for more than six weeks**, so the firm calendar never meets the one-year cap
  on its own; the cap still applies to anything reading the calendar through the API.
- **A very busy window says so.** The calendar walks each read to its end, up to a ceiling; past
  it, the screen says it is showing the first entries rather than pretending the month is complete.

## Related features

- [Continuing a hearing](continuing-a-hearing.md) — when the court vacates a setting and makes a
  new one, the record shows both.
- [Firm events and rooms](firm-events-and-rooms.md) — meetings, closures, and holidays that belong
  to the firm rather than to a case, and the rooms and vehicles they book.
- [Safe custody register](safe-custody-register.md) — review dates and due-backs for physical
  originals appear on the case timeline.
- [Filing email to a matter](filing-email-to-a-matter.md) — filed mail appears on the timeline.
- [Document templates and assembly](document-templates-and-assembly.md) — assembled documents appear
  on the timeline.
