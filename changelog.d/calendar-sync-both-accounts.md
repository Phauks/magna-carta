---
category: Changed
audience: public
---

**A member may connect an Outlook account and a Google account together.** `integration_connection` is unique on category, principal and adapter (migration `20261116T172646_a-member-connects-more-than-one-calendar-account`), so each account is its own connection with its own rules, copies, questions and pass. The member routes under `/api/v1/me/calendar-sync` take an optional `provider` query naming the account; the Calendar Sync page offers the choice only to a member with both. The event in the firm's calendar is the hub: an edit carried back from one account changes the event, and the other account's pass sends it on (`apps/api-worker/test/calendar-sync-outbound-pass.test.ts` proves it goes out once and does not come back). Disconnecting a Google account now withdraws the grant at Google (`revokeGrant` in `packages/google-calendar/src/sign-in.ts`), and the calendar lists a Google account's own events under My Google Calendar.

## Public

You can connect your Outlook and Google calendars at the same time. A change you make to a shared event in one of them reaches Magna Carta and then your other calendar. Disconnecting Google now also removes Magna Carta from your Google account's list of apps.
