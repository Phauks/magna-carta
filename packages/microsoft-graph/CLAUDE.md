# @magna-carta/microsoft-graph — CLAUDE.md

**Purpose.** Everything Magna Carta says to Microsoft on a member's behalf: signing a member in to
their own Microsoft 365 account, and the calendar sync port over Microsoft Graph. Pure package: no
binding, no clock and no transport of its own. The caller hands in an `HttpClient`, the time and the
random bytes, so every branch runs in a test with no network.

**Spec:** [`docs/specs/2026-11-10-calendar-sync-design.md`](../../docs/specs/2026-11-10-calendar-sync-design.md).

## Key files / entry points

- `src/sign-in.ts` — the authorization-code flow with a proof key: the address a member's browser
  is sent to, trading the returned code for tokens, and refreshing. `MICROSOFT_CALENDAR_SCOPES` is
  the whole calendar grant
- `src/calendar-sync-adapter.ts` — `CalendarSyncPort` (defined in `packages/calendar/src/sync-port.ts`)
  over Microsoft Graph. Every event it writes carries `WRITTEN_COPY_PROPERTY_ID`, and the read back
  asks for events carrying it and nothing else, so no event the member made is ever read. Changing
  that identifier orphans every copy already written

## Local rules

- **No mailbox scope.** Nothing here asks for a `Mail.*` permission. How a message is matched to a
  matter is undecided, and a wrong filing puts one client's correspondence on another client's
  matter, so the calendar grant stays the only grant until that is settled.
- **Plain requests, no vendor library.** Microsoft's own client libraries assume Node and pull in
  far more than the handful of calls made here.
- **Never read an error description.** The token endpoint's `error_description` can repeat what was
  sent, which includes the client secret and the member's code. Read the `error` code only, and put
  only text written in this package into a problem's title.
- **A token goes only to Microsoft.** A next-page address is followed only when it points back at
  `https://graph.microsoft.com/`.
- **One refresh at a time per account.** Microsoft may replace the refresh token on any refresh, so
  the caller serializes refreshes and stores the returned credential before using it.
- Every Graph request sends `Prefer: IdType="ImmutableId"`, so a stored identifier survives the item
  moving between folders.
