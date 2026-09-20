---
category: Added
audience: public
---

**The auto-file engine stops evaluating an empty set.** The guardrail function, the port on the
capture core and the evidence gatherer all shipped without the one thing that makes a delegation a
delegation: something that delegates. Nothing in the product created a rule — `createEmailAutoFileRule`
had exactly one caller in the repository and it was a test — so every unrouted capture paid two
indexed lookups, matched nothing, and returned `NO_AUTO_FILE_RULE_MATCHED`. Eight routes in
`apps/api-worker/src/routes/email/auto-file-rules.ts` close that: create from a filing, set the promotion
posture, suspend, resume, revoke, the matter's rules, one message's decision history, and the firm's
thirty-day review.

**Three refusals carry the weight, and each is pinned by a test that was watched to fail with the
refusal removed.** A rule may not be **stored** asking to file while the firm's ceiling is down —
accepting the posture and quietly staging would tell the member who set it that their firm had opted
into unattended filing, which is precisely the act no individual member may perform. A
`threadContinuation` rule is refused unless the conversation is already filed to the named matter,
because its entire claim is "your firm already decided this" and without a filed link that claim is
false. And a rule reached through a different matter's path is absent, so access to one matter can
never act on another's delegation.

**The review read narrows before it hydrates, and carries no cursor.** The matter set goes through
`filterAccessibleMatters` before a single rule row is read, so a rule on a matter the caller cannot
open contributes no entry, no count and no suspension line — it never enters the answer rather than
being filtered out of one. The window is fixed at thirty days and unpaged on purpose: a cursor over a
set a wall can shrink hands out short pages and calls them the end of the list. Counts come from the
links themselves rather than the ledger, so a filing somebody has since removed reads as removed —
the same signal the circuit breaker's undo input is derived from, which keeps the two from telling a
firm different stories about one rule.

**A partial index on `email_matter_link.auto_file_rule_id`,** over the automatic links only. The
shipped undo derivation subqueries that column with nothing behind it, which is a scan of every link
the firm holds, issued on the capture path the moment a rule matches. Partial so a firm with no rules
carries an empty index and the index grows with rule activity rather than with mail volume.

**A closed-set fitness sweep over four homes.** A rule kind, a suppression reason and a demotion
reason each live in the domain package's unions, the per-firm schema's column enums and CHECK
constraints, the data-access layer's structurally-identical declarations, and the API's zod enums —
four homes, which is the price of those layers not depending on each other.
`packages/email-filing/test/auto-file-closed-set-fitness.test.ts` reads all four out of the real source
and fails when one moves alone; adding a third kind to the API enum only was watched to turn it red.
It also asserts that no phrasing table interpolates anything, which is what makes "the explanation
carries no message content" a property of the code rather than of the caller's care.

**The load profile, and one claim that came back narrower than it was written.** Ten thousand rules
across a thousand matters cost no more per capture than ten (0.331 ms against 0.374 ms on this
machine) — the lookup is by match value, so the flat-cost claim holds. Two hundred firings inside the
breaker's window report as the cap rather than as two hundred, and the cap still sits above the
threshold, so a runaway rule neither drags its whole history onto every later capture nor escapes the
breaker. The thread claim is the narrow one: the rule lookup for a conversation really is by
identifier and really is flat, but the read beside it — the thread's already-filed matters — joins
over every message in the conversation and grew thirty-one fold from eight messages to two thousand
(0.06 ms to 1.888 ms). That is inside a queue consumer's budget and is the same read the suggestion
endpoint already issues inside a request budget, so nothing was changed for it; the measurement
reports it rather than restating a sentence its own numbers contradict.

## Public

**Automatic filing can now be set up, watched, and stopped.** An auto-file rule puts a message on the
right matter as it arrives rather than waiting for somebody to go and find the matter — most valuable
on your firm's general capture address, where mail lands today with no matter at all. You can create a
rule from a message you just filed, change whether it files outright or places the message for
someone to confirm, pause it, put it back, or retire it for good.

**Two new answers you can ask for.** "Why is this message here?" returns the reasons behind an
automatic filing in plain sentences, weeks later, without anybody reconstructing them. And a
thirty-day summary tells you, per rule, how many messages it filed, how many it placed for
confirmation, how many of those somebody has since removed, and whether it has stopped itself — which
is the report to read **before** deciding whether to allow filing without a confirming click, so that
decision rests on what your rules have actually been doing rather than on a guess.

**Setting up a rule is a separate permission from filing mail.** Your firm can grant somebody the
ability to file email to a matter without also granting them the ability to configure the machine to
file email. A rule can only ever name a matter its creator can open, and it stops itself if they lose
that access.

**Rules stay cautious in the ways they always were.** A rule that follows a conversation can only be
created once your firm has actually filed a message from that conversation to the matter. Nothing
already in your archive is ever touched — creating, resuming or re-pointing a rule applies only to mail
that arrives afterwards. And a rule asking to file without confirmation is refused outright while your
firm has not enabled that, rather than being accepted and quietly doing something else.

The screens for all of this are still being built; what a rule does once it exists is described in
[Filing email to a matter](features/filing-email-to-a-matter.md).
