---
number: 242
slug: email-auto-file-rules
status: Proposed
date: 2026-08-05
area: Email filing / capture
summary: "Auto-file rules are a TYPED, MATTER-BOUND, REVOCABLE DELEGATION over the shipped capture pipeline — three rule kinds (thread continuation, correspondent-to-matter, exact matter number in subject), no expression language, no regex, no keyword, and no sender-domain kind (a domain is one-to-many by construction, so its own condition guarantees the ambiguity guardrail suppresses it exactly where a firm has the volume to want it). A matter-bound capture address is recognized as ALREADY an auto-file rule and is deliberately not re-expressed as a row: it proves that ROUTING and PROMOTION are separable questions the platform has already answered separately, since even a hand-minted credential naming a matter still lands its mail staged. The consent verdict follows ADR-0214: an auto-file rule lands a STAGED link with the matter chosen and its reasons attached, per-rule opt-in to direct filing, behind a firm policy that is off until an administrator enables it — a ceiling, so no member can opt the firm into unattended filing; on the catch-all path a staging rule is not toothless, because it converts 'captured, unrouted, someone must find the matter' into 'staged on the right matter, one click from filed'. The guardrails are the design and fail closed: ambiguity is computed STRUCTURALLY (how many distinct matters the deciding evidence names) rather than from the ranking's score-tie `ambiguous` flag, so a future tuning change to how a suggestion list is ORDERED for a human cannot silently change which messages file themselves; promotion traverses the shipped filing-time conflict hook, so the conflicts engine will protect automatic and manual filing identically with no second integration; a rule fires only into a matter its creator could access at creation AND still can at fire time (suspend, never delete), while the 'the mail's recipients could see it' test is REJECTED as unsatisfiable and directionally wrong — correspondents are external parties the platform has no account for, and inbound mail from opposing counsel is exactly the mail worth filing. The DKIM precondition is a RULE INPUT, not a change to the informational verdict posture: the verdict gates the robot, not the record — nothing is dropped, hidden, or degraded, only the machine's permission to act unaccompanied — and it binds asymmetrically, requiring an intact original plus a `pass` with a matching domain only for the one kind whose condition is an identity claim, which means correspondent rules structurally never fire on forwarded captures. A rule never contradicts a human (no firing on a message already filed or previously unlinked by a person), never fires into a closed matter, and trips a per-rule circuit breaker on firing rate or undo rate. Every outcome including suppressions is recorded in an evaluation ledger holding identifiers and enums only; undo is the existing unlink route unchanged, and undoing an automatic link is the feedback that suspends the rule."
---

**Auto-file rules are a typed, guardrailed delegation that lands staged by default; the guardrails,
not the rule kinds, are the design.**

**Context:** The email-filing subsystem has shipped everything auto-filing was waiting on — the
capture pipeline with per-matter and catch-all capture addresses, dedup, the thread DAG, the
staged-link/accept/unlink flow, the four-signal matter-suggestion ranking with its `ambiguous` flag
(whose own header comment says it exists for the rule that does not exist yet), and the DKIM verifier
with its settled informational posture. What was missing was never a signal. One
`acceptOnCapture: true` in the capture consumer would file mail automatically today. The missing
thing is the decision about when the platform is permitted to act on signals it already holds, and
what it owes the firm afterwards. The failure mode being defended against is specific and has
happened to competitors at scale: the wrong-matter mass-file, where a broad rule quietly files
hundreds of messages onto the wrong matter and the firm finds out when privileged material reaches
the wrong party.

**Decision:**

1. **A matter-bound capture address is already an auto-file rule, and the rule table does not
   re-express it.** The credential is the condition; possession is the evidence. Mirroring each
   address into a rule row would create two homes for one fact that drift on the first rotation. More
   importantly it settles the model's shape: a capture address answers _which matter_ with the highest
   confidence available anywhere in the subsystem — a person minted a credential naming that matter —
   and the shipped pipeline still lands the result **staged**. Routing and promotion are separable,
   the platform already answers them separately, and every rule kind inherits that separation.

2. **Three rule kinds, closed set, no expression language.** `threadContinuation` (a reply to a
   thread already filed to exactly one matter — the only signal whose evidence is the firm's own
   prior decision rather than a guess about the world, and the only one that strengthens rather than
   decays over time), `correspondentMatter` (the message's `From` address, normalized, matching a
   rule address — `From` only, because a CC is not a statement about what a message is about), and
   `matterNumberInSubject` (exact match through the shipped extractor and the matter-number index) as
   a firm policy toggle rather than a per-matter row, since the message names the matter itself.

3. **Regex, keyword, and sender-domain rules are refused.** A member-authored regex is an evaluator
   running attacker-influenced input inside the capture path with backtracking behaviour invisible in
   the pattern; a substring keyword files the locksmithing newsletter onto the Smith matter; and
   neither can be rendered as the plain sentence the evidence trail owes the person reviewing it —
   restating the pattern is not a reason. The deeper objection is that the guardrails must know what a
   rule _means_ to reason about competing evidence, and a pattern means nothing beyond "it matched".
   Sender-domain rules are refused on a different ground: a domain is one-to-many by construction, so
   the counterparties worth writing one for — a bank, an insurer, a large opposing firm, a court — are
   exactly the ones corresponding about many matters, which means the rule's own condition guarantees
   the ambiguity guardrail suppresses it where a firm has volume and permits it only where
   `correspondentMatter` already suffices. A rule that is either suppressed or redundant is not a
   rule kind.

4. **Staged by default; direct filing is a per-rule opt-in behind a firm policy that is off until an
   administrator enables it.** ADR-0214's three rules map mechanically: detection is always on (a
   stage-only rule still records that it matched, and a suppressed match records why, so a firm's
   decision to enable direct filing is informed by data it already has rather than a leap); the
   conversion is opt-in (two explicit acts by two kinds of principal — an administrator for the firm,
   a member for the rule); and the decision carries input, guidance, and feedback (the offer states
   what will and will not fire, every outcome reports its reasons, and the fire/undo counters report
   how the rule has actually behaved). The firm switch is a **ceiling**, not a default: with it off,
   every rule stages regardless of its own posture, so no member can opt the firm into unattended
   filing. Direct-with-visible-undo was argued and rejected as the default because undo is only
   visible to someone who looks, and because the shipped user documentation states outright that
   nothing is silently auto-filed — a sentence that should become conditional for a firm that chose
   otherwise, not false for everyone by default.

5. **A staging rule is not toothless, which is the fair objection.** On the add-in path it adds
   little, since a person is already choosing. On the catch-all and forward paths it converts
   "captured, unrouted, someone must go find the matter" into "captured, staged on the right matter,
   with reasons, one click from filed" — which is most of the value at most of the volume, and which
   the suggestion machinery structurally cannot deliver because it answers a question asked from a
   mail client and on that path nobody asked.

6. **Ambiguity is computed structurally, not from the ranking's `ambiguous` flag.** The shipped flag
   is true when candidates tie on _score_, and the score is a sum of tuning constants; making an
   unattended filing depend on them means a future adjustment to how a suggestion list is _ordered
   for a human_ silently changes which messages file themselves. The engine instead partitions
   evidence into deciding (matched rules, thread continuation, exact subject matter number) and
   non-deciding (participant-party, which accumulates by design because one person is a party on many
   matters, and the typed search term, which does not exist off the request path), and suppresses when
   the deciding set names more than one distinct matter. That test cannot be moved by a tuning change
   and is strictly more conservative than the score tie. `ambiguous` keeps its job of telling a client
   not to pre-select.

7. **The access answer, stated honestly.** A rule may name only a matter its creator could access at
   creation — that is what makes it a delegation rather than an escalation — **and** the creator must
   still hold that access at fire time, because access is withdrawn as well as granted and the shipped
   filing-context read already refuses to treat a member's own history as an exemption from the
   current answer. A rule whose creator lost access is **suspended and surfaced, never deleted**: a
   suspended rule with its history is diagnostic, a deleted one leaves the firm unable to explain what
   had been filing. The proposed "and the mail's recipients could see the matter at fire time" test is
   **rejected**: correspondents are clients, opposing counsel, courts and vendors with no platform
   identity, so the test is unsatisfiable for most inbound mail and would specifically exclude the
   letter from opposing counsel, which is the mail most worth filing; and it inverts the obligation,
   inventing an access claim about people the firm has no account for. What a wall actually cares
   about — disclosure to a matter's cohort — is already handled, because promotion traverses the
   shipped filing-time conflict hook, which demotes to `staged` on any hold. Automatic and manual
   filing therefore get the conflicts engine identically, with no second integration and no new call
   path.

8. **The DKIM precondition is a rule input, not a change of verdict posture.** The posture forbids the
   verdict from causing a message to be dropped, quarantined, refused, hidden, degraded, or filed —
   every item on that list is a way the verdict could make the platform's treatment of the firm's mail
   worse or more automatic. A precondition on unattended promotion runs the other way and can only
   make the platform _less_ automatic: the message is still captured, parsed, deduplicated, recorded
   with the same verdict and reason, suggested with the same evidence, and one click from filed.
   **The verdict gates the robot, not the record.** It binds asymmetrically, and only where the
   question is answerable: `correspondentMatter` requires an intact-original capture, a `pass`, and a
   verified domain matching the rule address's domain, because it is the only kind whose condition is
   a claim about who sent the message and `From` is trivially spoofable; the other two are suppressed
   only by a `fail` on an intact-original capture, since forging them requires knowing a `Message-ID`
   the firm holds or the firm's own numbering, and succeeds only in putting the message where it
   claims to belong. `unverified` is "no answer", never "no". The consequence is stated rather than
   patched: forwarding breaks signatures, so a correspondent rule structurally never fires on the
   forward or catch-all path — the platform cannot tell who sent that message, only who forwarded it,
   and a rule trusting sender identity has nothing there to stand on.

9. **A rule never contradicts a human, and never fires into a matter that is not open.** No firing on
   a message a person has already filed elsewhere, or previously unlinked from the target — the first
   is the mass-file shape, the second is a person's active removal being undone by a machine. A rule
   naming a closed or archived matter suspends rather than fires.

10. **A per-rule circuit breaker on firing rate and undo rate.** A mailing list, a bounce loop, an
    autoresponder, or a newsletter from a client's domain shows up as an unusual firing rate before it
    shows up as a hundred wrongly-filed messages. Over threshold, the rule reverts to staging by
    itself and surfaces — a property of the rule, not an operations alert.

11. **Every outcome is recorded, including the suppressions, with no message content.** A nullable
    `auto_file_rule_id` on the shipped `email_matter_link` says whether a machine made the link and
    which rule; an `email_auto_file_decision` ledger records fires and suppressions with a closed
    reason enum, written only where a rule matched or a match was suppressed, so it stays proportional
    to rule activity rather than mail volume. Identifiers and enums only — the rule the capture
    idempotency body already follows — with the plain-language reasons rendered at read time.
    Maintained fire/undo counters on the rule row were rejected: two contended hot-path writes for a
    number a bounded index walk produces off the request path.

12. **Undo is the shipped unlink route, unchanged, and undo is the feedback.** No new reversal
    endpoint. Unlinking an automatic link additionally records a reversal against its rule, and a rule
    being undone at a rate over threshold suspends itself on the same mechanism as the blast bound.

13. **Evaluation runs inside `captureEmail`, reached through an optional port, and is bounded.** At
    the point where the matter and link state are decided, so the automatic link rides the existing
    atomic batch and the existing idempotency outcome body reports it to a polling client with no
    contract change; a redelivery replays the identical decision rather than re-deciding. At most five
    additional bounded index walks per capture, two of them statements the suggestion endpoint already
    issues inside a request budget. Cost does not scale with rule count (the lookup is by match value),
    mail volume, or thread length. The decision itself is a pure function on the shape
    `rankMatterSuggestions` established, failing closed by construction: the default arm is `stage`,
    an unevaluable precondition yields a suppression reason rather than an exception, and any error in
    gathering degrades the capture to exactly today's behaviour rather than losing it.

**Considered & rejected:** _mirroring capture addresses into rule rows_ (two homes for one fact, drift
on the first rotation); _sender-domain rules_ (self-defeating — suppressed where wanted, redundant
where permitted); _regex and keyword subject rules_ (an evaluator on hostile input, unexplainable in
an evidence trail, and opaque to the guardrails that must reason about meaning); _a combinator
expression language_ (the template-expression precedent — a new evaluator with its own semantics and
audit problem, buying expressiveness the guardrails would then defeat case by case); _reading the
ranking's `ambiguous` flag as the firing gate_ (couples an unattended act to human-facing tuning
constants); _the "recipients could see the matter" access test_ (unsatisfiable for external
correspondents, and it would exclude precisely the mail worth filing); _direct filing with visible
undo as the default_ (undo is visible only to someone who looks); _maintained fire and undo counters
on the rule row_ (contended hot-path writes for a derivable number); _rules that sweep the archive or
retro-file on creation_ (a different act with a different consent shape); _multi-matter rules_
(multiplies a wrong rule's blast radius, and the ambiguity guardrail exists to refuse the non-singular
answer); _machine-learned ranking_ (an unattended filing justified by a weight vector cannot be
audited by the person who must answer for it).

**Consequences:** the subsystem gains an automatic filing path that adds no new filing code path —
the decision runs before the existing one and can only produce values it already produces. The firm
catch-all stops being a queue of unrouted mail, which is the case that pays for the feature, and the
same engine becomes the substrate mailbox sync will require rather than sync arriving with a filing
path of its own. The shipped filing-time conflict hook acquires its second caller, so the Phase-4
conflicts engine will cover automatic filing with no further work. The user documentation's
"nothing is silently auto-filed" sentence acquires a conditional clause for firms that opt in. Three
schema changes (two per-firm tables, one nullable column) and one new capability. Costs: a closed rule
set means a fourth kind is a design change rather than configuration, and correspondent rules cannot
fire on the forward path at all — both deliberate, and both the guardrails working rather than gaps to
close. Spec:
[`docs/specs/2026-08-05-auto-file-rules-design.md`](../specs/2026-08-05-auto-file-rules-design.md);
plan:
[`docs/specs/2026-08-05-auto-file-rules-implementation-plan.md`](../specs/2026-08-05-auto-file-rules-implementation-plan.md).
