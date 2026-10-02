---
number: 362
slug: a-silenced-notification-is-counted-not-absent
status: Proposed
date: 2026-08-16
area: Notifications
summary: "A member's per-category notification preferences ride one `notifications.preferences` scoped-setting key, and the two channels compose in opposite directions: in app the firm's tier is a floor a member may not lower, and by email the member's tier wins because a firm may not force privileged-adjacent metadata into a mailbox it does not administer. Two categories — security and trust — are non-silenceable in app whatever either tier stores. Because a category set `inApp: off` writes NO feed row, a suppression would otherwise be indistinguishable afterwards from a notification nobody raised: so the fan-out writes a `notification_in_app_suppression` tally (member, category, civil day, whose choice, count — and nothing else) beside the rows it did write, and reports a `notifications.suppressed_by_preference` counter. The firm's trust-compliance designation joins the recipient set of every trust-category notification without granting access, and the visibility filter still decides at read what those rows may show — which is why no delivery row is written at fan-out for a member who cannot see the matter."
---

**A preference that silences a notification must leave a record that it did. Everything else in this
decision follows from that one sentence.**

**Context:** The subsystem's whole delivery half now exists and every category is on for everybody,
which is the recommended default and also the reason nobody has yet had to answer the hard question:
what happens to a notification a member has asked not to receive. Two answers are available and only
one of them is safe. Writing the row and hiding it at read leaves a row somebody later discovers —
and a row that reappears the day a filter is loosened by accident. Not writing it at all is correct
and produces the failure mode a preference system actually has: **silence**. Afterwards, "nobody was
told" and "this person asked not to be told" look identical. A member cannot be reassured, an
operator cannot find a real fan-out fault, and the counter that would have shown it reads zero for
both.

**Decision, in four parts.**

**1. One key, and two channels that compose in opposite directions.** `notifications.preferences`
holds the whole per-category matrix (`inApp: on|off`, `email: off|daily|weekly`) on the shipped
`user → firm → default` scope chain. One key rather than eleven because the chain reads one key per
call and the fan-out resolves preferences once per recipient. The composition is asymmetric on
purpose:

- **In app, the firm's tier is a FLOOR.** A firm may set a category `inApp: on` and a member cannot
  override it downward. An in-app row is inside the platform — behind the session, the chokepoint,
  and the visibility filter — and costs the member a badge.
- **By email, the member's tier WINS.** A firm may never raise a member's cadence. Forcing email is
  forcing privileged-adjacent metadata into a mailbox that may be a personal address, may be outside
  the firm's administration, and is beyond both the audit log and the wall. A firm that needs
  assurance a partner sees trust events has a better instrument: the mandatory in-app row, plus the
  trust reconciliation reports, which are a firm-scoped read with a permission of their own.
- A firm's in-app `off` is a firm-wide **default a member may raise**, not a ceiling. A floor binds
  upward only, and a firm has no legitimate interest in stopping somebody hearing about their own
  work.

**2. `security` and `trust` are non-silenceable in app, from either tier.** They mirror the
non-optional stance of the audit log, and the rule is read from the category rather than declared per
type, so two kinds in one category cannot disagree. A member may still set either category's **email**
cadence to `off`: putting a row in a feed the platform controls and posting a copy into a mailbox it
does not are different acts. An `off` on a mandatory category is **stored rather than refused** — the
member's stated wish is real and survives the day the category stops being mandatory — and the
response reports honestly that it does not apply, so nobody is left believing they switched off a
trust notification.

**3. A suppression is a counted fact, never an absence.** The fan-out writes
`notification_in_app_suppression`, keyed `(recipient_user_id, category, civil_date, reason)`, and
emits `notifications.suppressed_by_preference` with the category and whose choice it was. It carries a
member, a closed category label, a civil day, a closed reason, and a count — and deliberately no
event, no subject, no matter, and no kind. A per-item record of what somebody declined to hear would
be a second feed holding exactly the pointers they asked not to be given, and it would outlive the
access check that justified the notification. The day-grain answers what a support conversation
actually asks. The tally is swept on the firm's own retention window beside the notifications it
explains, because a count with nothing left to compare it against answers no question worth keeping
it for. The member's own preference read reports their own tally back to them, so a member can see
that their choice, and not a fault, is why nothing arrived.

An audience everybody in it silenced is counted **apart from** an audience that resolved to nobody.
Only the second is a resolver problem, and folding them together would hide a working preference
behind a counter that means "something is broken".

**4. A designation adds a recipient; it does not grant access.** A firm-tier
`notifications.trustComplianceRecipients` list, written under `trust:manage` and audited by **count**
rather than by name, joins the recipient set of every `trust`-category notification in addition to
whatever the kind's own audience resolves. It is applied to the category rather than to one audience
value, in the one shared resolver, so all three production paths inherit it and none can forget.

**Deviation from the implementation plan, and why.** The plan asked for a
`notification_delivery` row with `suppressed_reason = 'not-visible'` and no feed row where a
designated member cannot see the matter. That is not built, for two reasons that point the same way.
`notification_delivery.notification_recipient_id` is `NOT NULL` and references the recipient row, so
the row the plan describes cannot exist. More importantly, deciding visibility at fan-out **is
emission-time enforcement**, which this subsystem exists to refuse: access changes after emission, and
a member added to a matter on Tuesday should see what is still live. So the designated member gets an
ordinary recipient row and the shipped read filter decides — the feed and the unread count of a
designated member who cannot see the matter are byte-identical to a firm where the notification was
never raised, with no placeholder, which is the property the plan was after. A `not-visible` delivery
row is a fact about the **email** channel and belongs to the digest that writes one.

**Considered and rejected.** **Writing the feed row and hiding it at read** — a row somebody later
discovers, and one that reappears on any filter mistake. **Counting suppressions in telemetry only** —
the counters carry no member by design and must not, so "did Jane's settings stop anything" would be
unanswerable, which is precisely the question. **A per-suppression row naming the notification** — a
shadow feed of what somebody declined to hear, retained on its own clock. **A firm ceiling on email
cadence** — the mirror of the content ceiling already shipped, and the wrong shape: a firm capping
what an email may SAY protects a client, and a firm capping whether a member is mailed at all protects
nobody. **A new `notifications:manage` capability for the preference write** — the capability registry
declines one explicitly, and the three feed-settling routes beside it already gate a member's own
self-scoped write on `notifications:read`.

**Consequences:** Silencing a category now writes nothing to the feed and something to the tally, so
the two states a preference system confuses are distinguishable afterwards, per member and per day.
The firm gains exactly two levers — an in-app floor it may raise, and a trust designation that adds
readers without adding access — and gains no way to reach into a member's mailbox. The preference
surface is an API and no screen; nothing in `docs/user/` describes it yet, because there is nothing a
member can reach.
