---
number: 509
slug: calendar-sync-is-per-member-rule-driven-and-magna-carta-is-the-record
status: Accepted
date: 2026-11-10
area: Calendar / Integrations
summary: "Calendar sync with Outlook and Google is per member, off until a member writes a rule for an event type, and bounded by a firm limit per type. Magna Carta is the record: a change made at the provider flows back, a delete there never cancels anything, deadlines are one-way, and no meeting invitations are sent. Email sync is not part of it and waits on its own design."
---

**Calendar sync is per member, rule-driven and off by default, and Magna Carta is the record.**

**Context:** the owner named two-way sync with Outlook his first roadmap priority on 2026-11-10, with
Google second. Reviewing the first design the same day he ruled that not every event should sync, that
a member chooses by event type and by destination calendar, that event types are listed one by one and
never bundled, that calendar and email settings are separate, and that matching email to matters needs
its own conversation before any mailbox is connected.

**Decision.**

- **Per member.** Each member connects their own account; nobody reads through another's connection.
  This is the user scope the connection model already declares for calendar.
- **A rule per event type, and no rule means no sync.** A rule names the destination calendar and the
  scope. Connecting an account syncs nothing, and a type the firm adds later starts unsynced.
- **The firm sets an outer limit per type:** whether it may leave, and with how much detail. A member
  syncs less than the limit or the same, never more.
- **Magna Carta is the record.** A provider-side edit to time, title, location or notes updates the one
  shared event and is audited. A provider-side delete raises an issue for the member and cancels
  nothing. Deadlines are written one-way and put back if changed. A true same-field conflict keeps the
  local value and offers the other.
- **Each connected participant gets their own copy, and no invitations are sent.**
- **A link row per event and account** carries the provider's identifier, in place of the single
  nullable column the calendar design expected, because one event has one identifier per member.
- **Email is excluded.** No mailbox permission is requested by calendar sync.

**Considered and rejected.** Last-writer-wins by clock time, which lets a stale phone overwrite a court
date. Letting a provider delete cancel the event, for the same reason. One organizer copy with the
other members as invited attendees, which emails outside parties and duplicates on a second sync.
Grouping event types into a few rows, which the owner rejected on sight.

**Consequences.** Six new per-firm tables and no change to the event tables; a Durable Object per
connected account; a public webhook route. The provider reviews gate less than the roadmap said:
Microsoft publisher verification limits self-service consent at other firms, and Google's security
assessment attaches to the restricted Gmail scopes. Design:
[`docs/specs/2026-11-10-calendar-sync-design.md`](../specs/2026-11-10-calendar-sync-design.md).
