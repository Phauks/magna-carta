---
category: Added
---

Auto-file rules for captured email — design. A specification for filing mail to the right matter
without a person present, built over the capture pipeline and the matter-suggestion machinery that
already ship.

The design starts from an observation about what is already there: **a matter's forward/CC capture
address is already an auto-file rule.** Someone minted a credential naming a matter and handed it to a
correspondent, and every message sent there routes to that matter with no further judgement — and the
platform still lands the result staged for a person to confirm. That is not an oversight. It is the
subsystem saying that even a perfect answer to _which matter_ does not by itself authorize an
unattended filing, and every rule in this design inherits that split: a rule carries a routing
condition and, separately, whether it may file or only stage.

**Three rule kinds and nothing else.** Replies to a conversation already filed to a matter; mail from
a named sender to a named matter; and the firm's own matter number written in the subject line, matched
exactly. Rules are learned from real filing — the offer made after someone files a message by hand —
rather than authored in an abstract editor, because a rule created that way inherits a real person's
real decision as its justification.

**What was asked for and refused:** keyword and regular-expression subject rules (a pattern cannot be
explained to the person reviewing why a message filed itself, and a rule for "Smith" files the
newsletter about locksmithing), and sender-domain rules — refused not as risky but as self-defeating,
since the counterparties whose domains a firm would want a rule for, a bank or an insurer or a large
opposing firm, are precisely the ones corresponding about many matters at once.

**The guardrails are the feature.** A rule never fires when the precise evidence points at more than
one matter. A rule never files past a conflict or ethical-wall hold — automatic filing goes through
the same check a person's filing does, so the conflicts engine will cover both with no extra work. A
rule fires only into a matter its creator could reach when they made it and can still reach now; a
rule whose creator has been walled off is suspended and shown, never quietly deleted. A rule never
contradicts a person: not on a message somebody already filed elsewhere, and not on one somebody
removed. A rule never files into a closed matter. And a rule that suddenly starts firing far more
often than usual — a mailing list, a bounce loop, an autoresponder — stops filing on its own and asks.

**Signature checking becomes a condition on the machine, not on the mail.** A sender's authenticated
signature is required before a rule that trusts sender identity may act unattended, because the "from"
line on an email is trivially forged. Nothing about the message changes: it is still captured, still
recorded, still suggested, still one click from filed. What is withheld is only the machine's
permission to act unaccompanied. A practical consequence, stated rather than papered over: forwarding
breaks signatures, so sender rules never fire on forwarded mail at all — on that path the platform can
tell who forwarded a message but not who sent it.

**Auto-filing lands staged by default.** A rule puts the message on the right matter with its reasons
attached and leaves the confirming click to a person; filing outright is a per-rule choice, available
only after an administrator turns it on for the firm, so no one member can opt a firm into unattended
filing. That default is not a token: on the firm-wide catch-all address, where mail arrives today with
no matter at all, a staging rule turns "someone has to go find the matter" into "it is already on the
right matter, one click from filed."

Every automatic filing records which rule fired and why, in plain language, so the question asked
weeks later has an answer that does not depend on re-deriving anything. Near-misses are recorded too —
what a rule would have done and why it was stopped — which is what lets a firm see how the rules have
actually been behaving before granting them more freedom. Undoing an automatic filing is the ordinary
unlink, unchanged, and it is also the feedback: a rule being undone repeatedly suspends itself.

Two specs, one decision record, and eight owner decisions. No product code, no user interface, no
notification delivery, and no machine-learned ranking in this cycle.
