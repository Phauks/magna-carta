---
category: Added
---

Auto-file rules for captured email — the rule model and the decision that guards it. A firm can now
hold auto-file rules, and the guardrail function can be handed a captured message's evidence and
asked what it would do with it. **Nothing evaluates during a capture yet:** no capture path, no
route, and no screen changes, so every message is filed exactly as it was before.

**What a rule is.** A typed, matter-bound, revocable delegation — a person who could have filed a
narrow class of messages by hand telling the platform to do it for the ones that arrive later. Two
kinds and no more: replies to a conversation already filed to a matter, and mail from a named sender
to a named matter. There is no pattern language, no keyword rule, and no way to write one; a rule is
a comparison whose meaning the guardrails can reason about, which is exactly what a pattern is not.
Every rule carries two independent answers — which matter, and whether the resulting link may be
filed rather than staged — because those are separable questions and the platform has always answered
them separately.

**The guardrails are the substance, and they fail closed.** A rule never fires when the precise
evidence points at more than one matter — two rules disagreeing, a rule contradicted by a matter
number in the subject line, a conversation that resolves to two matters. It never fires into a matter
its creator can no longer open, and never into one that is closed, prospective, or platform-owned. It
never files past a conflict hold; it stages instead, on the same check a person's filing already
traverses. It never contradicts a person: not on a message somebody already filed elsewhere, and
never — the sharpest edge of the rule — on one somebody deliberately removed from that matter. A
sender rule requires an authenticated signature from the rule address's own domain, which means it
structurally cannot fire on forwarded mail, where the platform can tell who forwarded a message but
not who sent it. And a rule firing far more often than a person would, or whose recent filings keep
being undone, stops filing on its own and asks. Anything that cannot be worked out at all counts as
"no", never as "yes".

**Staged by default stays true.** A rule's own posture, the firm's ceiling, a conflict hold, and the
circuit breaker can each turn a filing into a staged link; none of them can turn a staged link into a
filing. Direct filing needs two explicit acts by two different kinds of person — an administrator
enabling it for the firm, and a member choosing it for one rule — and the firm ceiling is off until
somebody turns it on.

Also lands the evaluation ledger's tables and its bounded reads, so the platform can report what a
rule did and what stopped it in plain language with no message content recorded anywhere, and a new
`emails:manageAutoFileRules` capability held separately from "may file mail" — because configuring
the machine that files mail is a different grant, and a firm should be able to hand out one without
the other.

Fixed alongside: the `@magna-carta/email-filing` package declared a subpath export for an
`already-filed` module that never existed. The already-filed read lives in the worker's email routes
over the email-filing statements, so the stale entry is removed.
