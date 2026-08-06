---
category: Added
---

Notifications — the delivery half — design. A specification for how a raised notification reaches a
person: the record, the channels, preferences, the delivery mechanics, and who is allowed to read the
result.

The design starts from an inventory, and the inventory is the reason it is small. **Forty-four places
in the platform already decide that something notification-worthy happened, and none of them was
connected to anything.** Thirty-one of those already write a durable message in the same atomic commit
as the change it describes — that is the transactional outbox, shipped, swept every five minutes, and
already publishing onto a per-firm queue that resolves the firm's database and dispatches by topic.
Six more are declared constants in the calendar. One is a query in the safe-custody register. One is a
placed no-op in email filing. Five are background-job coordinators that already announce their own
completion. So the work is not building a pipeline; it is **subscribing to the one that exists**, and
deciding the policy questions nobody had answered.

**Nothing that emits changes.** The notification consumer becomes a second, non-exclusive pass on the
queue that is already there, so no write path in billing, trust, matters, documents, files, or the
directory gains a line. The emission points that are comparisons rather than events — a deadline that
is due, a deadline that is overdue, a custody review that has come round, a check-out that has not come
back — are read by the existing nightly sweep calling the functions those subsystems already export,
bucketed by civil date so a permanently-true comparison raises once a day instead of once every five
minutes. The safe-custody register's promise that delivery would subscribe to its one collection point
rather than grow a second definition of what is due is kept exactly.

**A notification carries no sentence anybody typed.** Identifiers, counts, dates, and labels from
declared lists — and no matter title, client name, filename, or email subject line, enforced by a
value grammar rather than by review. The card a member reads is assembled when they read it, from the
kind of thing that happened plus a matter lookup that is already filtered by what they may see. That
is both the strongest privacy posture and the only one that cannot go stale: a stored title survives a
rename and a renumber, and is wrong in a way that looks authoritative.

**An email says how much is waiting, never what it is about.** A fixed subject, per-category counts,
and one link back into the app — no matter numbers, no titles, no dates, no amounts. The reasoning is
that email is the one channel that cannot be taken back: everything else the platform delivers is
re-filtered every time it is read, so a person removed from a matter stops seeing it, while an email
sent yesterday is simply out there, in a mailbox the firm may not administer, on a lock screen, in
somebody's backup. Content that never depended on access is the only content safe against access
changing, and a count is exactly that. Sign-in alerts, password resets, and invitations are about the
person reading them rather than about a client, and keep their full content.

Preferences reuse the settings machinery already in place, per category rather than per event type,
with email as a daily or weekly digest and no per-event mail. Trust and security notifications cannot
be silenced in the app. A firm can require that a category reaches its people in-app, and deliberately
cannot force email on anyone — mandating email means pushing case-adjacent metadata into a mailbox
beyond the firm's reach. A firm may name partners who receive every trust notification, and being
named is not a grant of access: where the matter is screened from them, nothing is delivered and no
placeholder appears, because "one item you cannot see" tells you it exists.

Two specs, one decision record, and five owner decisions — the email content boundary being the one
that is a matter of taste rather than of correctness. No product code, no user interface, and no push
or SMS in this cycle.
