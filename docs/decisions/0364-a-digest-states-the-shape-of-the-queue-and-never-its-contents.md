---
number: 364
slug: a-digest-states-the-shape-of-the-queue-and-never-its-contents
status: Proposed
date: 2026-08-16
area: Notifications
summary: "The notification email digest carries a fixed matter-free subject holding a count, a line of per-category counts, and one link back into the product — and nothing a person typed: no matter title, matter number, client or party name, filename, email subject line, deadline description or date, custody number, amount, or invoice number. The boundary is structural rather than remembered: the digest read selects a category, a kind, an instant, and two handles, and the renderer's only parameters are a closed category label, integers, a cadence label, and a deployment-configured origin, so there is no argument a title could arrive in. `matter-number`, the owner-directed detail level under a firm's ceiling, stays declared and unbuilt and renders as `counts-only` — a stored ceiling is honoured at its most private reading rather than silently rewritten. A summary is composed per member per cadence from a keyset watermark through the SAME shared read the feed and the unread count compose, so the wall binds at delivery time in one implementation rather than two; it SENDS FIRST AND MARKS SECOND, because a duplicate summary is an annoyance where a lost one is a missed deadline; a member with nothing visible in the window gets no email at all; and every row a run did NOT mail is settled as a `suppressed` `notification_delivery` row naming a closed reason, so a member who chose not to be written to stays distinguishable from a member the platform silently failed to write to. Outbound mail is an unprovisioned seam that reports a typed not-configured reason rather than resolving to the dev logging adapter, which would have recorded `sent` for mail nobody received."
---

**An email is the one notification channel the platform cannot re-filter, so it carries only content
that never depended on access in the first place — which is exactly what a count is.**

**Context:** Every notification surface built so far is a row a member reads inside the product,
behind their session, the enforcement chokepoint, and the visible-matter predicate. A row rendered to
the wrong person there is a bug with a fix, because the next read fixes it. The digest is the first
time this subsystem hands a copy to infrastructure the firm does not control: retained by a provider
the firm did not choose, indexed by a desktop client, backed up, forwarded, and rendered on a lock
screen to whoever is looking. The wall in this subsystem deliberately binds at read time so that a
member removed from a matter on Tuesday stops seeing Monday's notifications about it. That works for
every channel the platform can re-read. **An email sent yesterday to somebody walled off the matter
today is simply out there.**

The owner answered the standing flag on this (ADR-0255): email content becomes a member's choice
under a firm's ceiling. The ceiling vocabulary and its composition shipped with the preference slice;
what remained was what each level actually renders, and that is what this records.

**Decision.**

**1. A digest states the shape of the queue and never its contents.** A fixed, matter-free subject
carrying only a count (`Magna Carta — 6 items need your attention`); a body of per-category counts
(`Deadlines 3 · Documents 2 · Trust 1`); one link back into the product; and a sentence saying the
mail carries counts only and why. Explicitly not carried: matter titles, matter numbers, client or
party names, document or file names, email subject lines, deadline descriptions or dates, custody
numbers or item descriptions, amounts, invoice numbers, platform handles of any kind, and the
identity of anybody involved. A matter **title** is client-identifying by construction — firms name
matters after the parties and the dispute. A matter **number** is client-identifying to anyone
holding a prior email, an invoice, or the firm's own file index, which for the population that ends
up reading a forwarded work email is most of them. A count discloses nothing about a client; it
discloses the recipient's own workload, to the recipient.

**2. The boundary is structural, not a rule to be remembered.** The digest read selects a category, a
kind, an instant, and two handles — there is no title column anywhere in this subsystem to omit, and
the read deliberately does not even take the subject, the matter, or the declared facts, none of
which it needs. The renderer's only parameters are a closed category label, integers, a cadence
label, and a deployment-configured origin: **there is no argument a caller could put a title in.** A
golden test renders over a fixture whose matter is named after its parties and numbered, and fails if
any of it reaches the output; a source scan fails a widened `SELECT`.

**3. `matter-number` stays declared and unbuilt, and renders as `counts-only`.** It is in the
vocabulary so a firm that has chosen it does not have that choice silently rewritten when the level
ships. Until it ships, a resolved level of `matter-number` renders exactly as `counts-only` — the
most private reading of a stored ceiling, never a matter number by accident. A resolved level of
`off` sends nothing at all.

**4. Text, not HTML.** A counts-only summary has nothing HTML buys: it renders identically in every
client, it cannot leak through a tracking pixel or a remote image fetch, and it keeps the send port's
signature unchanged.

**5. One read, one wall.** The digest is the dangerous read — it runs server-side, on a member's
behalf, with no request context, which is exactly where a "we already know who this is for" shortcut
gets written. It resolves through the **same** function the feed page and the unread count compose,
with the visible-matter predicate a required argument composed in SQL before the `LIMIT`. "The digest
respects the wall" therefore names one implementation rather than two that can drift, and the wall
fitness function covers it from the same table-driven pass.

**6. Send first, mark second; a keyset watermark per member per cadence.** The watermark is an
instant AND the event id that instant belongs to, because two events sharing an instant would
straddle a bare-timestamp boundary. The delivery rows and the watermark commit in one batch **after**
the send returns: a crash between the two re-sends a summary next run, where marking first risks
losing one. A duplicate summary against a missed deadline is not a close call. A run whose send did
not happen leaves the mark where it was and re-reads the same window.

**7. An email that was not sent is as findable as one that was.** The preference slice made a
silenced in-app notification a counted, attributable fact rather than an absence; the same
requirement binds here, and the shipped schema already had the mechanism. Every row a run withheld is
settled as a `notification_delivery` row with `state = 'suppressed'` and a closed reason —
`preference` where the member's cadence for that category is `off` or the resolved detail level is
`off`, `no-address` where there is no mailbox to write to — carrying no digest id, because no summary
carried it. A member who chose not to be mailed and a member the platform silently failed to mail are
therefore different rows, and the counters (`notifications.digest_suppressed` by reason,
`notifications.digest_unavailable` by port reason) make the difference visible without a member, an
address, or a subject ever reaching a dimension.

**8. An empty digest is no email.** A member with nothing visible in the window is written to not at
all — a "you have nothing" message trains people to ignore the channel, and a channel people ignore
has stopped working for the categories that matter. The run is still recorded, so "nobody has ever
written to this member" and "there has been nothing to write about" stay distinguishable.

**9. Anchored to the firm's own morning.** The pass wakes hourly and asks each firm whether its local
hour has come round, resolving the zone from the firm's own default office — the one the calendar
already books against — rather than storing a second copy of where the firm is. A firm that has set
no default location is anchored on the platform's clock, which is stated rather than substituted
silently.

**10. Outbound mail is an unprovisioned seam with a typed reason.** The digest resolves its own send
port rather than reusing the shared adapter resolver, because that resolver falls back to the dev
logging adapter when the Email Service binding is absent. That fallback is right for a password reset
and catastrophic here: a summary resolved through it would return successfully having written to
nobody, and the run would then record `sent` rows and advance the member's watermark — a durable
claim about mail that was printed to a log, with the member never hearing about those notifications
again. So the port answers `unavailable` with one of three closed reasons (no send binding, no
verified sender, no public origin), the pass exits before reading a single firm, and the reason is
counted every pass.

**Deviation from the plan.** The plan's task 4.3 asks the run to honour a registry-declared
`escalation: "immediate"` for the trust and security kinds. **No registered kind declares one**, and
an immediate send has no trigger without editing the raise paths, so building the sender would be
untriggered code and leaving immediate kinds in the digest would quietly mail a compliance-grade
notice as part of a day's counts. Instead the walk **halts** at the first such row rather than
stepping over it — the watermark stays behind it, so nothing is settled that no channel carried — and
a registry fitness test asserts that no type declares `immediate` today. Registering the first one is
therefore a gate failure until its send path ships, which converts an unbuilt path from a silent gap
into a refusal. The same treatment covers `emailContent: 'recipient-scoped'`, which no type declares
either.

**Considered and rejected:** *per-item lines carrying the matter number* (the owner's ceiling records
the preference; the level is not built, and a number is client-identifying to anyone holding a prior
invoice); *HTML* (buys nothing over counts, adds a remote-fetch surface); *excluding rows the member
has already read in app* (makes two members with identical queues receive different mail depending on
when they opened the app, and leaves the settled set disagreeing with the watermark that claims to
cover it); *a bare-timestamp watermark* (two events sharing an instant are carried twice or not at
all); *marking before sending* (at-most-once, against a missed deadline); *an empty "nothing today"
summary* (trains people to ignore the channel); *reusing the shared email adapter resolver* (records
`sent` for mail nobody received); *a per-run suppression tally* (the shipped `notification_delivery`
row already expresses "we decided not to mail you about this" per item and per channel, and a second
mechanism beside it would be two answers to one question).

**Consequences:** the preference slice's per-category email cadence gains its first reader; a sixth
cron trigger (hourly) and three deployment values (the Email Service binding, a verified sender, a
public origin) are the whole activation surface, recorded in the deploy queue; the notification
centre and the preference screens remain deferred, and the user-facing guide says plainly that the
digest cannot reach anybody until the firm's sending domain is provisioned.
