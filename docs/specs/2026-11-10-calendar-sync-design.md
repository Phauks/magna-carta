# Calendar sync with Outlook and Google — design

**Date:** 2026-11-10 · **Status:** Accepted (design); build in progress · **Area:** Calendar / Integrations
**Builds on:** [`2026-06-16-integration-port-system-design.md`](2026-06-16-integration-port-system-design.md) (the deferred credentialed adapter), [`2026-08-05-case-calendar-design.md`](2026-08-05-case-calendar-design.md) (the event model)
**Decisions:** `docs/decisions/pending/calendar-sync-is-per-member-rule-driven-and-magna-carta-is-the-record.md`, `docs/decisions/pending/a-permission-request-states-only-what-it-grants.md`
**Owner rulings:** 2026-11-10, recorded in [`../conventions/design-corrections.md`](../conventions/design-corrections.md)

## 1. Scope

A member connects their own Microsoft 365 account and their Magna Carta events are kept in step with
their Outlook calendar in both directions. Google Calendar is the second adapter over the same engine.

**Email is out of scope.** The owner asked for email sync in the same breath and then ruled
(2026-11-10) that how a message is matched to a matter needs its own design conversation first,
because a wrong filing can put one client's correspondence on another client's matter. Nothing in this
design requests a mailbox permission. The mailbox tier stays where
[`2026-06-16-email-filing-design.md`](2026-06-16-email-filing-design.md) left it.

## 2. What the owner ruled

1. **Not every event syncs.** A member decides, per event type, whether it syncs and to which of
   their Outlook calendars.
2. **Event types are listed individually.** They are never bundled into groups on the settings page.
3. **Calendar and email settings are separate pages** over one shared account, because the two have
   different consequences.
4. **A permission request states only what it grants.** It never lists what it does not grant, and it
   is short. It is one reusable component, not a screen written per feature.

The rest of section 3 is the author's recommendation, which the owner read on 2026-11-10 and did not
change when approving the calendar build.

## 3. Behaviour

Sync is per member. Each member connects their own account, and only their own calendar is touched.

| Direction               | What moves                                                         | Rule                                                                                                 |
| ----------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Magna Carta to provider | Matter events and firm events of a type the member's rules include | Written to the calendar that type's rule names. Each connected participant gets their own copy.      |
| Magna Carta to provider | Deadlines, when the member's rule includes them                    | All-day, one-way. A change made at the provider is put back.                                         |
| Provider to Magna Carta | A change to an event Magna Carta wrote                             | Time, title, location and notes update the one shared event, with an audit row naming the member.    |
| Provider to Magna Carta | Events in a provider calendar the member chose to show             | Kept in a private per-member table. Only the owner reads them. The owner can attach one to a matter. |
| Provider to Magna Carta | A delete                                                           | Never cancels the Magna Carta event. An issue is raised for the member.                              |

**Off by default.** Connecting an account syncs nothing. A type with no rule is not synced, and a type
the firm adds later starts with no rule.

**The firm sets the outer limit.** For each event type the firm says whether it may leave Magna Carta
and with how much detail (full, or matter number and type only). A member's rule can sync less than
the firm allows and never more.

**No invitations.** Magna Carta writes plain events, never meeting requests. An invitation would email
outside attendees and would duplicate an event that two members both sync.

## 4. Architecture

| Part                            | Home                        | Job                                                                                        |
| ------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------ |
| `CalendarSyncPort`              | `packages/calendar`         | List calendars, list changes since a cursor, create, update and delete an event.           |
| Microsoft adapter               | `packages/microsoft-graph`  | The port over Microsoft Graph with plain `fetch`. No vendor software kit.                  |
| Google adapter                  | `packages/google-workspace` | The port over the Calendar interface.                                                      |
| Sync decision                   | `packages/calendar`         | Pure: given the last agreed state, the local event and the remote event, say what to do.   |
| `ConnectionSync` Durable Object | `apps/api-worker`           | One per connected account. Serializes token refresh and sync passes; renews subscriptions. |
| Webhook route                   | `apps/api-worker`, public   | Verifies and queues a provider's "something changed" call, and answers at once.            |
| Sign-in routes                  | `apps/api-worker`           | Start and finish the provider sign-in; store the encrypted refresh token.                  |
| Permission request              | `packages/design-system`    | The reusable window that states what is being granted.                                     |

A provider-to-Magna-Carta change: the provider calls the webhook route; the route checks the secret it
set when subscribing, queues a message and answers; the queue consumer wakes that account's Durable
Object; the object asks the provider for everything changed since its cursor; the sync decision is
applied through the existing calendar services, so permissions, validation and audit rows are those of
an edit made in the app.

A Magna-Carta-to-provider change starts from the per-firm outbox: saving an event writes an outbox row
in the same batch, and the relay hands it to the Durable Object of each participant whose rules include
that event's type.

Reasons for the shape:

- **A notification only says "go look".** Microsoft Graph subscriptions on Outlook resources last at
  most 10,080 minutes without resource data and 1,440 with it
  ([subscription resource](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0)).
  The plain form plus a delta query is simpler and repairs itself after a missed call.
- **Three seconds to answer.** Graph treats a notification as delivered on a 2xx within 3 seconds,
  retries for up to 4 hours, and delays or drops notifications to an endpoint that is slow
  ([webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)).
  Hence queue first, work later.
- **One Durable Object per account.** Both providers rotate refresh tokens, so two refreshes at once
  can revoke each other. Single-file processing per account removes the race.
- **An alarm per account, not a firm-wide cron**, renews the subscription and runs a safety pass every
  few hours, because both providers say a notification can be delayed or lost.
- **Immutable identifiers.** An Outlook item's ordinary identifier changes when it moves folders.
  Every request sends `Prefer: IdType="ImmutableId"`
  ([immutable identifiers](https://learn.microsoft.com/en-us/graph/outlook-immutable-id)).
- **The webhook address names the account** with a signed opaque token for firm and connection, so no
  cross-firm lookup table exists and a forged call fails the signature check.

## 5. Data model

New per-firm tables. No column changes to `matter_event`, `firm_event` or `matter_deadline`.

| Table                      | One row per                                                | Holds                                                                                                         |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `calendar_sync_rule`       | Connection and event type (or the deadline kind)           | Destination calendar, scope (events I take part in, or all on my matters)                                     |
| `calendar_sync_firm_limit` | Event type (or the deadline kind)                          | Whether it may leave, and the detail level                                                                    |
| `calendar_sync_link`       | One Magna Carta event in one member's provider calendar    | Local kind and id, remote calendar and event id, remote version tag, hash of the fields as last agreed, state |
| `external_calendar_event`  | One event that exists only in a member's provider calendar | Owner, remote ids, title, dates, times, zone, repeat rule, and the matter event it was attached to, if any    |
| `connection_sync_state`    | One synced resource of one account                         | Provider cursor, subscription id and expiry, last successful pass, last error                                 |
| `connection_sync_issue`    | One thing a member should look at                          | Link, kind, the other side's values, resolved at and by                                                       |

The calendar design expected one nullable external-identifier column on the event. A link table
replaces it because one hearing can sit in several members' calendars under several identifiers: the
identifier belongs to the pair of event and account.

`integration_connection` is unique on category and principal, so a member holds one account per
category. Letting one person connect both Outlook and Google needs the adapter added to that index.

Titles and locations in `external_calendar_event` are personal and sometimes privileged. They are
protected columns, and every new table is classified in the personal-data registry.

## 6. Conflicts

Magna Carta is the record. The provider calendar is a copy the member can edit.

Each link keeps a hash of the synced fields as both sides last agreed. A pass compares that hash, the
local event and the remote event.

| Local     | Remote                    | Result                                                                      |
| --------- | ------------------------- | --------------------------------------------------------------------------- |
| Unchanged | Changed                   | Apply the remote change locally.                                            |
| Changed   | Unchanged                 | Send the local change, conditional on the remote version tag.               |
| Changed   | Changed, different fields | Merge field by field.                                                       |
| Changed   | Changed, same field       | Local value stays; an issue offers the remote value.                        |
| Any       | Deleted                   | Local event untouched; an issue offers to restore the copy or stop syncing. |
| Cancelled | Any                       | The remote copy is removed.                                                 |
| Deadline  | Changed                   | The remote copy is put back.                                                |

A write returns a new version tag (`changeKey` on Graph), which the link stores; a notification whose
tag the link already holds is the echo of our own write and is ignored. A create carries a
client-chosen `transactionId` so a retry cannot make a second copy
([event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)).

## 7. Repeating events

Magna Carta stores an RFC 5545 rule. Google uses the same text; Graph uses a structured pattern, so
the Microsoft adapter converts both ways, with a test for every shape the repeat editor can produce.
A rule Graph cannot hold is not sent and raises an issue.

One changed or cancelled occurrence is an exception row (`recurrence_parent_id` plus
`recurrence_occurrence_on`) and an exception instance at the provider. "This and all later events" is
two series locally, so sync sends one update and one create and moves the affected links.

## 8. Limits

- Graph's change feed for events runs over a date window
  ([delta query](https://learn.microsoft.com/en-us/graph/delta-query-overview)), so sync covers a
  rolling window of one month back and two years ahead.
- A provider may discard a saved cursor at any time. The account then makes one full pass over the
  window; link rows make that pass idempotent.
- Graph requires an all-day event to run midnight to midnight in one zone, and Magna Carta stores
  civil dates with an inclusive end. The adapter converts, under its own tests.

## 9. Sign-in and consent

Authorization-code flow with PKCE. The refresh token is sealed in `integration_credential` under the
firm key; the access token is held in memory only. The calendar grant asks Microsoft for
`Calendars.ReadWrite`, `User.Read` and `offline_access`, and nothing about mail.

Microsoft publisher verification is free and limits ordinary users at _other_ tenants from consenting
to an unverified multitenant app
([publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)).
A firm whose administrator consents for the tenant is a separate path. That reading is the author's and
is proved against the owner's tenant before sync is switched on for it.

Disconnecting revokes the token at the provider, deletes the credential, cancels the subscriptions,
and asks whether the provider copies stay.

## 10. Screens

| Screen                       | Where                                 |
| ---------------------------- | ------------------------------------- |
| Connected Accounts           | My Settings                           |
| Calendar Sync (member rules) | My Settings                           |
| Calendar Sync (firm limits)  | Firm Settings, Practice               |
| Calendar sync issues         | On Calendar Sync and as notifications |
| Permission request           | A window, from any feature that asks  |

## 11. Build order

1. This design, its decisions and the documentation corrections.
2. The permission request component, and connecting an Outlook account with the calendar grant only.
3. Rules, firm limits and events out to Outlook.
4. Changes back from Outlook, and provider calendars shown privately.
5. Repeating events.
6. Google Calendar.

Every step ships behind the `calendar-sync` feature flag until the owner turns it on for a firm.

## 12. Open

- Whether Google classes the Calendar scopes as sensitive or restricted. The verification pages name
  no Calendar scope as restricted, and the scope page read on 2026-11-10 does not state a class.
- Whether Microsoft meters any of these Graph calls.
- Whether other members should see "Busy" for a member's private provider events. Today they see
  nothing.
