---
category: Added
audience: internal
---

**Notifications can now leave the platform, and a digest says only how much is waiting and in which
categories. A fixed subject carrying a count, a line of per-category counts, one link back in — and
nothing a person typed.**

This is the first time this subsystem hands anything to a mailbox. Every surface before it was a row
read inside the product, behind the session and the visible-matter predicate, where a row shown to
the wrong person is fixed by the next read. An email is a copy retained by a provider the firm did
not choose, forwarded, backed up, rendered on a lock screen — and it **cannot be re-filtered when
access changes**, which is the whole basis on which the wall here binds at read time. So the content
stops at what never depended on access in the first place.

**What a digest line may contain:** a category label from the closed vocabulary, and an integer.
**What it may not:** matter titles, matter numbers, client or party names, filenames, email subject
lines, deadline descriptions or dates, custody numbers, amounts, invoice numbers, platform handles.
The boundary is structural rather than remembered — the digest read selects a category, a kind, an
instant and two handles, and the renderer's only parameters are a closed label, integers, a cadence
and a configured origin, so there is no argument a title could arrive in. A golden test renders over
a fixture whose matter is named after its parties and numbered, and fails if any of it reaches the
output.

**The first reader of the per-category email cadence.** The preference slice stored a cadence and
nothing consumed it; the run now partitions each member's window by it. A category on the other
cadence is left to that cadence's own watermark; a category set `off` is **withheld and recorded**,
not dropped — every row a run did not mail gets a `suppressed` delivery row naming a closed reason,
so a member who chose not to be written to stays distinguishable from a member the platform silently
failed to write to. That is the same requirement the in-app suppression tally answers, met with the
mechanism the schema already had.

**Send first, mark second**, on a keyset watermark (an instant _and_ its event id — two events
sharing an instant must not straddle a boundary), per member per cadence, committed in one batch
after the send returns. A crash between them re-sends a summary; marking first would lose one. A
member with nothing visible in the window gets no email at all. Runs are anchored to the firm's own
morning, resolved from the default office the calendar already books against.

**Outbound mail is an unprovisioned seam.** The digest resolves its own send port rather than reusing
the shared adapter resolver, which falls back to the dev logging adapter when the Email Service
binding is absent — right for a password reset, catastrophic here, because the run would record
`sent` rows and advance watermarks for mail that was printed to a log. Absent a binding, a verified
sender, or a public origin, the port answers with a typed reason, the pass exits before reading a
firm, and the reason is counted every pass. Owner steps are in `docs/deploy-queue.md`.

Still deferred: the notification centre and the preference screens (no `apps/web-worker` change here), and
the `matter-number` detail level, which stays declared and renders as `counts-only` so a firm's
stored ceiling is honoured at its most private reading rather than silently rewritten.
