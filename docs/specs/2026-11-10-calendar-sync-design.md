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

As built, `calendar_sync_rule` and `calendar_sync_firm_limit` are keyed by a `subject`: an event
type's id, or the literal `deadline`. A subject with no firm limit row may leave in full detail,
because a member's own rule is still required and those start empty. The firm limit is set under its
own permission, `calendar:manageSyncPolicy`, held by Owner/Admin. Stopping a subject from leaving
deletes every member's rule for it in the same batch.

A member's sealed sign-in sits in `integration_credential`, whose one decrypt gate
(`integrations:useConnection`) the default roles give to administrators alone. The worker reads a
member's own calendar sign-in on that member's behalf through a store that derives the reference
from the session's user id and refuses any other
(`apps/api-worker/src/calendar-sync/member-credential-store.ts`). Microsoft does not revoke the old
refresh token when it issues a new one
([refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)), so
reading the calendar list from a request is safe before the per-account Durable Object exists.

As built, the direction out is a reconciliation and not a relay of changes. A pass reads the
member's rules, the firm's limits, every event in the window that could be theirs and the links
already written, and sends the difference (`packages/calendar/src/sync-outbound.ts`,
`apps/api-worker/src/calendar-sync/outbound-pass.ts`). The outbox was the planned trigger and is not
used: the three calendar topics are raised only when a setting moves or is cancelled, so an edit to
a title would never have reached Outlook. Instead a successful write on a calendar path asks every
account with a rule for a pass, the per-account object folds requests into one pass a few seconds
later, and it runs a safety pass every six hours for what no trigger covers (an event entering the
window, a matter assignment changing). `calendar_sync_link` is keyed by connection, kind and local
id; it is written in a `pending` state with the request's `transactionId` before Microsoft is asked,
so a create whose answer was lost is repeated under the same identifier. A repeating series is not
sent until section 7 is built.

As built, a change at the provider is picked up by a watch and not by waiting. A pass that reaches
Microsoft keeps one Graph subscription per account on `me/events` for created, updated and deleted
([create subscription](https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0)),
asked for three days where Graph allows a little under seven, and renewed once less than two days
are left (`apps/api-worker/src/calendar-sync/change-watch.ts`). The notice address is
`/api/v1/calendar-sync/provider-notices/microsoft/{firmId}/{connectionId}` on the deployment's
stated public address, and the same address is the subscription's lifecycle address. It differs
from the plan above in one way: the path names the account in the clear and proves nothing, and the
account's object believes a notice only when its `clientState` is the secret that object generated
for the subscription, compared in constant time. A request without it is answered `202` like any
other and changes nothing, so no signing key exists to manage. The route answers Graph's validation
token as plain text
([webhook delivery](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks)),
reads only the secret and the lifecycle word from a notice, and never which event changed: a
believed notice brings the account's ordinary pass forward to one second away, and the pass reads
the account. `reauthorizationRequired` renews at the next pass, `subscriptionRemoved` begins a new
subscription, and `missed` runs a pass
([lifecycle notifications](https://learn.microsoft.com/en-us/graph/change-notifications-lifecycle-events)).
A delta query is not used yet: the pass still lists the copies it wrote, which is what it needs
until events made at the provider are read. The watch is three methods on `CalendarSyncPort`
(`watchChanges`, `renewWatch`, `stopWatch`) and the notice reader is the provider package's own
(`packages/microsoft-graph/src/change-notices.ts`), so a second provider adds a reader and a route
and changes nothing in the object or the pass. Our own writes come back as notices too, and each
costs one pass that finds nothing to send. The six-hour safety pass stays, because Graph says a
notice can be delayed or dropped. A watch is not ended when a member disconnects: the token that
could end it is deleted in that same step, the notices are no longer believed, and Graph drops the
subscription within three days.

As built, the first step of the direction back notices and does not apply. Every copy is written
with a named extended property of the platform's own, and a pass that has nothing left to send asks
Graph for the events carrying it
([filtering by an extended property](https://learn.microsoft.com/en-us/graph/api/singlevaluelegacyextendedproperty-get?view=graph-rest-1.0)),
so an event the member made themselves is never read. A copy whose `changeKey` is the one our own
write was given is untouched. Otherwise its title, location, days and times are compared with the
event as it would be sent now, read in the event's own zone; notes are not compared, because Graph
hands a body back reformatted. A difference becomes a `connection_sync_issue` row, keyed as the link
is, holding both sides, and the member answers it on Calendar Sync with Put Back or Leave It. A copy
missing from the list is confirmed by asking for it by identifier before it is called deleted. A
deadline's copy is written back without asking. The rows of the conflict table in section 6 that
apply a remote change to the Magna Carta event are not built: whether one member's edit in Outlook
may move an event everyone on the matter shares is an open owner question. Reading every marked
event on each pass replaces the delta cursor for now, so `connection_sync_state` is still unbuilt
(`apps/api-worker/src/calendar-sync/provider-changes.ts`,
`packages/calendar/src/sync-issue-statements.ts`).

As built, an edit to a copy is now applied, by the owner's ruling of 2026-11-10 that an edit made
in Outlook changes the Magna Carta event without asking. It supersedes the open question in the
paragraph above for edits; a deleted copy is still only a question and never cancels anything, and
a deadline's copy is still put back. The edit goes through the calendar's own service as an
ordinary edit by that member (`apps/api-worker/src/calendar-sync/apply-provider-edit.ts`), so the
event's shape is validated, the audit row names the member, a moved matter event raises the same
`rescheduled` topic it would from its own window, and a second audit row,
`calendar_sync.provider_edit_applied`, says the change came from the member's calendar. It is an
edit in place and not a continuance. Three limits keep it to what the member could have done and
what a copy can faithfully say. The member must hold `calendar:manage`; without it the edit stays
a question. Only the days and times are carried, plus the title and place where the firm's limit
is full detail; a copy sent with minimal detail has a title the platform wrote, so an edit to that
alone is put back. A series' first day is never moved from a copy, because Graph's documentation
does not settle where a dragged series begins. A changed single day of a series is covered in
section 7. After an edit is applied every account with a rule is asked for a pass, so colleagues'
copies follow, and this member's own copy is written once more in full, which also sets right any
part of the edit that was not carried. When the event and the copy both changed between two
passes, the event wins: a pass sends before it looks.

For deadlines the narrow scope means the matters the member is responsible for and the wide one
every matter they are assigned to, because a deadline names no person.

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

As built, events a member made in Outlook are read into `external_calendar_event`, private to that
member. The member chooses which of their account's calendars are shown
(`calendar_sync_shown_calendar`, replaced whole through
`PUT /api/v1/me/calendar-sync/shown-calendars`); a calendar shared to them read-only is as good a
choice as their own. At the end of each pass `apps/api-worker/src/calendar-sync/shown-calendars.ts`
asks the provider for each chosen calendar's view of a window (a month back, a year ahead) and
makes the table agree: a new event is written, one whose version tag changed is written again, and
one the provider no longer lists is removed, unless the provider's list was cut short. A copy this
platform wrote is left out, a single one by its identifier in `calendar_sync_link` and a day of a
series by the series it belongs to. The window is asked through Graph's `calendarView`, which lays
a series out as its days, so the table holds one row per day and no repeat rule; that is the one
departure from the table as designed above, which carried a rule. A whole-day event is stored as
civil days and a timed one as two instants, because the provider answers in its own zone and the
reader's screen decides the day and hour. The read route
(`GET /api/v1/me/calendar-sync/account-events`) finds the account through the session member and
nothing a request names, and answers from the table without asking the provider. On the web the events are one calendar in the rail, `My Outlook Calendar`, listed only
for a member who chose a calendar and painted with their own titles at the reader's hour
(`apps/web/src/lib/calendar/own-account-events.ts`). Colleagues see
nothing, not even busy time, which leaves that open question as it was. Attaching one of these
events to a matter is not built. The whole window is read again on each pass; a delta cursor is the
next step if that proves slow.

As built for Graph, a series leaves as one event carrying a `recurrence` pattern and range
([recurrencePattern](https://learn.microsoft.com/en-us/graph/api/resources/recurrencepattern?view=graph-rest-1.0),
[recurrenceRange](https://learn.microsoft.com/en-us/graph/api/resources/recurrencerange?view=graph-rest-1.0)).
The conversion is one way so far (`graphRecurrenceOf` in
`packages/microsoft-graph/src/calendar-sync-adapter.ts`). It refuses the rules where the two
readings could part ways, because Graph's documentation does not say what it does with them: a
monthly or yearly date past the 28th and a fifth weekday (this platform skips a month without one),
and a weekly rule that leaves out the series' own first day (this platform counts that day). A
refused series is not sent and raises a `not_sent` issue. A changed day is sent as an ordinary event
of its own, and every day a row stands in for, changed or called off, is removed from the Graph
series by deleting that occurrence
([list instances](https://learn.microsoft.com/en-us/graph/api/event-list-instances?view=graph-rest-1.0)),
again after every write, since changing a series' rule restores them.

As built, a day a member changes inside a series in Outlook is noticed. After the ordinary look at
the copies, each series copy is asked for its changed days through Graph's `exceptionOccurrences`
([event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0)),
one request per series. Which day it was is read from `originalStart`, placed in the event's own
zone, and a day the rule does not fall on is left alone. A day that reads differently from the
series carried onto that day is applied as that day's own change through
`changeMatterEventOccurrence` or `changeFirmEventOccurrence` with the scope "this", under the same
permission and detail limits as any edit carried back, so the day gets a row of its own and the
next pass sends that row and takes the day out of the Graph series. A change that cannot be
carried is written back onto that day as it was sent. No question is raised for one day, because
`connection_sync_issue` is keyed by copy and a series is one copy. A day the member deleted is not
among the exceptions, is not noticed, and cancels nothing
(`apps/api-worker/src/calendar-sync/provider-changes.ts`, `listSeriesChangedDays` and
`updateSeriesDay` on the port).

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

Disconnecting deletes the credential, cancels the subscriptions, and asks whether the provider copies
stay. Google's token is also revoked at Google. Microsoft offers no way to revoke one application's
token for one member short of ending all of that member's sessions, so the Microsoft token is deleted
and not revoked, and the member can remove the application's access from their Microsoft account.
That last sentence is the author's reading of the Microsoft identity documentation, which describes
no per-token revocation endpoint in the
[authorization-code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).

Connecting and disconnecting take `calendar:read`: a member connects an account so that the events
they can already see reach their own calendar, and every statement behind the routes is scoped to the
session's own user. The connection row carries the account's own address (`account_label`), so a
member with two Microsoft accounts can see which one is connected.

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

Every step ships dormant. The flag provider is not bound in production, so a catalog flag could never
be turned on; the switch is instead the Microsoft application's two secrets, absent until the owner
registers one ([`../deploy-queue.md`](../deploy-queue.md)). Pages stay out of the settings navigation
until there is something for a member to do on them.

## 12. Open

- Whether Google classes the Calendar scopes as sensitive or restricted. The verification pages name
  no Calendar scope as restricted, and the scope page read on 2026-11-10 does not state a class.
- Whether Microsoft meters any of these Graph calls.
- Whether other members should see "Busy" for a member's private provider events. Today they see
  nothing.
