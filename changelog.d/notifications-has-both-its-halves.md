---
category: Added
audience: public
---

**The notifications settings surface ships, both tiers.** The backend was complete on both and the pages were the only thing missing — the Notifications nav group rendered empty.

`/settings/notifications` (My Settings, instant, `notifications:read`) is the member's per-category matrix over `GET`/`PATCH /api/v1/notifications/preferences`. `/settings/notification-policy` (Firm Settings, instant, `firm:manageNotificationPolicy`) is the firm's three levers over `GET`/`PATCH /api/v1/firm/notifications/policy`.

A MATRIX, not a page of rows: one subject with two independent answers per category, so both pages are tables rather than the settings row anatomy. Both are instant, the departure Users already makes — twelve rows times two channels plus two scalars is twenty-six independently meaningful, separately audited choices, and staging them behind one Save would make the pending count meaningless.

**Neither page computes what applies.** `resolveCategoryPreference` is the one place the two tiers compose, and it stays there: every member row arrives resolved with `inAppLockedBy` saying whether it may be moved and who decided, so a locked switch renders as a locked badge with the reason on hover rather than as a control that silently refuses. The asymmetry is what the firm page's wording carries — in app, `on` is a floor nobody may lower while `off` is only a default a member may raise; by email nothing is a ceiling at all, because forcing a copy into a mailbox that may be personal is not a thing a firm may do to somebody.

The member page shows what a choice COST: the server's per-category suppression tallies, said where the switch is, so switching a category off is a decision rather than a disappearance.

`apps/web/src/lib/notifications/category-vocabulary.ts` mirrors the wire enums by hand and says why in its header: reaching for `@magna-carta/notifications` for twelve words pulls most of the backend's dependency closure into the web app and trips `tooling/affected-lint/scope-fitness.mjs`, which caps fan-out sinks. `apps/web/test/notification-category-vocabulary.test.ts` checks the mirrored categories and cadences against the emitted contract, so a category added to the platform fails there rather than reaching a member as a raw key.

## Public

**Choose what you hear about.** Settings · Notifications lists every kind of thing the platform can tell you — deadlines, calendar, tasks, trust, billing, documents, custody, email, conflicts, jobs, security, system — with one switch for your in-app feed and one choice for email, category by category. Email arrives as a daily or weekly summary rather than a message per event.

A category you have switched off tells you what it has held back, and since when, so turning something off stays a decision you can see the effect of rather than a silence you have to notice.

Two categories, trust and security, always reach you in app. Your firm may also insist on others; those say so and cannot be switched off. Nobody can force email on you — whatever your firm suggests, your own choice wins.

**Firms set their side under Settings · Notification Policy:** which categories everybody hears whatever they choose, how long notifications stay in the feed, and what hour the summary mail is sent.
