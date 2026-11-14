# @magna-carta/google-calendar — CLAUDE.md

**Purpose.** Everything Magna Carta says to Google on a member's behalf: signing a member in to
their own Google account, and the calendar sync port over the Google Calendar API. Pure package: no
binding, no clock and no transport of its own. The caller hands in an `HttpClient`, the time, the
random bytes and the channel identifiers, so every branch runs in a test with no network.

**Spec:** [`docs/specs/2026-11-10-calendar-sync-design.md`](../../docs/specs/2026-11-10-calendar-sync-design.md).

## Key files / entry points

- `src/sign-in.ts` — the authorization-code flow with a proof key: the address a member's browser
  is sent to, trading the returned code for tokens, and refreshing. `GOOGLE_CALENDAR_SCOPES` is the
  whole calendar grant. The account is named by its primary calendar's identifier, which is the
  account's own address, so no profile permission is asked for.
- `src/calendar-sync-adapter.ts` — `CalendarSyncPort` (defined in `packages/calendar/src/sync-port.ts`)
  over the Google Calendar API. Every event it writes carries the private extended property
  `WRITTEN_COPY_PROPERTY_NAME`, and the read back asks for events carrying it and nothing else, so
  no event the member made is ever read as a copy. Changing that name orphans every copy already
  written. `googleRecurrenceOf` builds the series' lines from the rule as read and returns null for
  the one rule Google is not relied on to put on the same days; a null is refused before any
  request, never approximated.
- `src/change-notices.ts` — reads the headers Google posts to a watch's address into the
  calendar's `ProviderNotice`: the secret, and whether it is only the greeting a new watch sends.
  Which calendar changed is deliberately not read.

## Local rules

- **No mailbox scope.** Nothing here asks for a Gmail permission, or any permission beyond the two
  calendar ones. How a message is matched to a matter is undecided, and a wrong filing puts one
  client's correspondence on another client's matter, so the calendar grant stays the only grant
  until that is settled.
- **Plain requests, no vendor library.** Google's client libraries assume Node and pull in far more
  than the handful of calls made here.
- **Never read an error description.** The token endpoint's `error_description` can repeat what was
  sent, which includes the client secret and the member's code. Read the `error` code only. From a
  Calendar API refusal, read only the `reason` word that tells a limit from a refusal.
- **A token goes only to Google.** Every address is built here from a fixed origin; a next page is
  asked for by its token, never by an address Google handed back.

## Gotchas

- **An event's identifier names its calendar.** Google identifies an event only inside a calendar,
  so the port's `remoteId` is `<event identifier, percent-encoded>/<calendar identifier>`
  (`googleEventReference`). A series' days and its `seriesRemoteId` use the same form, which is how
  the caller matches a day to a series it wrote. A copy the member moves to another calendar is no
  longer found and reads as deleted.
- **A change is merged, so a write names every field.** `googleMoments` sets the fields that do not
  apply to null. Without that, a copy changing from timed to whole-day keeps its old time beside
  its new date and Google refuses it. An event that happens once sends `recurrence: []` for the
  same reason.
- **A deleted event is still answered for a while,** with `status: "cancelled"`. Every read and
  write here treats that as gone.
- **A create is made safe to repeat by choosing the identifier.** `googleEventIdFor` derives it
  from the caller's transaction identifier; a second try is answered 409, and the copy the first
  try made is read back as the answer.
- **Google does not say which days of a series were changed.** `listSeriesChangedDays` answers
  every day of the series from a month back to about a year on, and the caller, which knows what
  the series was sent as, keeps the ones that differ. A whole-day's original date is answered as
  noon UTC of that date, which reads back as the same date in any zone less than twelve hours from
  UTC.
- **A watch is one channel per calendar and cannot be renewed.** `watchChanges` begins a channel on
  each readable calendar (the member's own first, twenty at most) and packs them into one
  `watchId`. `renewWatch` ends them and answers null, so the caller begins a new watch in the same
  pass. A calendar Google will not watch, such as a public holiday calendar, is left out.
- **Google answers 403 for a limit and for a refusal alike.** `problemFor` reads the reason to tell
  them apart, because only a limit is worth retrying.
