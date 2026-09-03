---
category: Added
audience: public
---

**The calendar is reachable, and it is one component.** Slices 6·1 and 6·2 had been the largest built-but-unreachable surface in the program: thirty-three routes, a federated read, firm events, resources, links and continuance, and one matter tab that read two tables. `docs/specs/2026-09-02-calendar-interface-design.md` plans the interface and this lands its first slice.

Two homes, on the EventRail division. `@magna-carta/design-system/calendar-grid` is the domain-free presentation: `CalendarGrid.Month`, `.Week` and `.Agenda` take entries with a civil day, a label, a detail line, a caller-formatted time, a subtle-register tone and a strike, and never learn what a hearing is. `apps/web/src/lib/calendar/` holds `CalendarView`, the one calendar every surface embeds with a scope (`firm`, `mine`, `matter`); it owns the window arithmetic on `CalendarDate` (a month is the full weeks it spans, never more than six, inside the read's cap), the read plan per scope, the projection through one vocabulary, the view state mirrored into the address, and the entry window. Both are registered in `tooling/lint-one-ui/registry.json`, so a second month grid or a second calendar composition fails the gate.

The firm grid paints kinds and matter numbers, never titles: the federated read declares non-privileged labels by design, and the title is fetched for the one row somebody opened. Deadlines paint from their own access-gated read with titles and the read-time overdue flag; the federated read is narrowed to the event kind so nothing is painted twice; firm events paint from the firm's own listing. The three reads fail independently and the notice names which one did; each walk has a page ceiling and says when it hit it.

`/calendar` is the firm screen (Mine / Everyone, month / week / agenda, a Record menu); `/calendar/firm-events?entry=` is the deep link the federated read already emitted. The matter's Calendar section keeps its two tables as the List view and gains Month and Agenda over the same component, and its two record controls go live: the earlier deferral to a participant picker is answered by building the picker (a firm member, a directory entity, or somebody who is neither). The entry window is a `RecordWindow` with in-place editing and the verbs the record allows; every form is an `ActionDialog` over a pure draft model, asserted without a browser. The sidebar's Calendar row flips to shipped.

## Public

**The calendar has a screen.** Calendar is now in the sidebar. It opens on the whole firm's month: every hearing, deposition, filing and deadline on every matter you can see, and the firm's own meetings, closures and holidays beside them. One press narrows it to what is on your own calendar, and the address remembers which you chose, so a link hands a colleague the same view.

On the firm-wide grid an entry reads as what it is and which matter it is on, "Hearing, 2026-0042", and never as its title: a calendar that spans every case does not broadcast what each one is about. Press an entry and it opens with its title, its people, its place and the zone its time is read in. Deadlines show their titles and say when they are past due, worked out in their own time zone each time you look.

Month, week and agenda are three views of the same calendar. A day with more than the grid can show says how many more and opens the agenda on that day. The week is seven days with each day's entries listed, because most of what a firm records is a date rather than an hour.

Recording no longer waits on anything. From the calendar's Record menu, or from a matter's own Calendar section, record an event on a matter, a deadline on a matter, or a firm event. A person at an event is picked from the firm, from the directory, or typed once for somebody who is neither, such as a judge or a court reporter. A deadline asks for the authority it comes from in your own words and never calculates a date.

Open an entry to correct it in place, cancel a setting with a reason, continue a hearing the court has moved (both settings stay on the record, linked, and the window lists the deadlines that hung off the old one without moving any), satisfy a deadline, vacate one with the reason, or supersede it with a new one.

The matter's Calendar section keeps the two tables it had as its List view and adds Month and Agenda beside them.
