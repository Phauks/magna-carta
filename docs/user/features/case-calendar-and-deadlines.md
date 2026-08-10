# Case calendar and deadlines

_The backend is built. The calendar screens — a month grid, a week view, an agenda list, and the matter timeline — are authored when those surfaces ship; today events and deadlines are recorded through the API._

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
  coming; asserting when a hearing is, is its own capability.

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
