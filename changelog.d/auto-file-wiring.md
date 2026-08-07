---
category: Added
---

Auto-file rules now act. The guardrail engine that shipped with the rule model was firing from
nothing; it is wired into the email-capture path, so a message that arrives with no matter — the firm
catch-all, an unrouted forward — has its rules evaluated and lands on the right matter with its
reasons attached.

**Where it runs, and why that is off the hot path.** Evaluation happens inside the capture consumer,
the queue worker that already parses, hashes, deduplicates and thread-links every captured message.
The capture route did not grow a rules pass: it still stages the raw bytes and enqueues, exactly as
before. Reached through an optional port on the capture core, the decision is made at the point the
matter and the link state are chosen, so the automatic link rides the capture's existing atomic write
batch and its existing idempotency record — a redelivered job replays the decision it already made
rather than deciding again, and the ledger row explaining a filing can never survive a batch that
rolled back. The read budget is fixed and small, and none of it grows with the firm's rule count
(rules are found by match value, never scanned), its mail volume, or a conversation's length.

**Staged by default, and the ceiling is real.** A rule places the message on the matter and leaves the
filing to a person unless two different kinds of principal have both asked otherwise: an administrator
raising the firm's ceiling, and a member choosing direct filing for that one rule. The firm switch is
new here — off until somebody turns it on, and a ceiling rather than a default, so a rule that asks to
file still only stages while it is down, with the policy recorded as the reason. Turning it on changes
the next capture and reaches back for nothing already captured.

**What the guardrails do in the wired path.** Evidence naming more than one matter files nothing.
A sender rule on forwarded mail never fires, because forwarding breaks the signature the rule's own
condition rests on. A message somebody already filed elsewhere, or deliberately removed from the
matter, is left alone. A closed matter is refused and the stale rule that named it is suspended. A
rule whose delegating member can no longer open the matter stops. Nothing reaches `filed` without
traversing the same filing-time conflict hook a person's accept does — a hold demotes an automatic
filing to staged exactly as it demotes a manual one. And a rule firing far more often than a person
would goes back to staging and takes itself out of service.

**The visibility the opt-in depends on now populates.** Every evaluation where something happened —
a rule matched, or a match was suppressed — writes a ledger row naming the rule, the matter, the
outcome and the reason, so a firm can see what its rules have been proposing before deciding whether
to let them act. A capture no rule looked at writes nothing, which is what keeps that record
proportional to rule activity rather than to the firm's mail. Every automatic link names the rule that
made it, and an automatic filing writes the same shape of audit row a manual one does. No subject, no
address and no display name reaches any of it — identifiers and enums only, with the sentences a
person reads rendered from them.
