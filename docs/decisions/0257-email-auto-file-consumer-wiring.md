---
number: 257
slug: email-auto-file-consumer-wiring
status: Proposed
date: 2026-08-07
area: Email filing / capture
summary: "Wiring the auto-file guardrail engine into the capture consumer settles five questions the rules decision left to build time. Rules are consulted ONLY where no entrance routed the capture — the firm catch-all and the unrouted forward — because an entrance that already resolved a matter answered the routing question with better evidence than a rule has (a credential naming that matter, or an authenticated member choosing it), and a rule second-guessing it would be the wrong-matter mass-file with extra steps. The filing-time conflict hook reaches the evidence gatherer as a CLOSURE supplied by the capture core rather than as an import, so `checkFilingConflict` keeps exactly one call site and the promotion gate and the recorded reason are the same answer: a gatherer cannot report 'no hold' for a matter the hook holds, and the capture core re-applies that memoized answer before it commits, so no automatic path reaches `filed` without traversing it. On a DEDUP HIT the signature is re-adjudicated rather than read back from the message row, because the shipped row records the verdict but not whether the signature covered the whole body — and a partially-covered `pass` is exactly what a sender-identity rule must decline — so the choice is one cached DNS lookup on a duplicate capture where rules could fire, against a schema column that would have to be right for every row written before it existed. `matterNumberInSubject` ships as AMBIGUITY EVIDENCE ONLY and its firm toggle is deliberately NOT built: the shipped engine has no routing path for a subject number (a firing requires a matched rule), so the toggle would be inert and an inert switch in an administrative screen is worse than an absent one. Undo feedback is derived from the LINK's own state — a link a rule made that somebody unlinked — rather than from a reversal row written by the unlink route, so the unlink contract is untouched and a reversal cannot be missed by a path that forgot to record it."
---

**Wiring the auto-file engine into the capture consumer: the entrance decides routing where it can,
the conflict hook keeps one call site, and the signature question is asked rather than stored.**

**Context:** The rule model and the pure guardrail function shipped without a caller. Turning them on
meant answering questions the design deliberately left open until there was real code: which captures
the rules are allowed to look at, how the conflict hook is reached from a gatherer that has no
business importing it, what the signature evidence is on a message the firm already holds, and which
of the design's three rule kinds the shipped engine can actually act on.

**Decision:**

1. **Rules are consulted only for a capture no entrance routed.** The value of a rule is on the firm
   catch-all and the unrouted forward, where mail lands with no matter at all and a person has to go
   find one. Where an entrance already resolved a matter — a capture address whose token names it, or
   an authenticated member filing from the add-in — the routing question has been answered with better
   evidence than any rule holds, and a rule that overrode it would be the failure mode this whole
   subsystem exists to prevent. The cost is that a thread rule cannot promote an entrance-routed
   staged link to filed; that is a person's click, and it is the conservative side to be wrong on.

2. **The conflict hook reaches the gatherer as a closure from the capture core, memoized per matter.**
   The alternative — the gatherer importing `checkFilingConflict` for itself — would give the hook two
   call sites and make it possible for the recorded reason ("a conflict held this") and the actual
   link state to disagree. With the closure the capture core owns the only call, the gatherer reports
   the hook's real answer for the matter that would actually be filed, and the core re-applies that
   same memoized answer to the decided matter before it commits. A rule therefore cannot reach `filed`
   past a hold by any path, which is the assertion the design asked a fitness function to make.

3. **On a dedup hit the signature is re-adjudicated, not read back from the row.** The shipped message
   row records the verdict, its reason, and the verified domain, but not whether the signature covered
   the whole canonical body — and a `pass` over a prefix is precisely what a sender-identity rule must
   decline, because the unsigned remainder is the part an attacker wrote. Storing the coverage bit
   would mean a new column that is null for every row written before it existed, so a rule evaluating
   an older message would fail closed anyway. Asking the verifier again costs one DNS lookup, on a
   duplicate capture, only where a rule could fire, and it gives the guardrail a real answer instead
   of a structural absence.

4. **`matterNumberInSubject` ships as ambiguity evidence only; its firm toggle is not built.** In the
   shipped engine a firing requires a matched rule, so a matter number in a subject line can only ever
   contribute to the deciding set and suppress — never route. A firm toggle for it would therefore
   change nothing, and an administrative switch that does nothing is worse than no switch: somebody
   turns it on, watches for the behaviour it promises, and concludes the feature is broken. The toggle
   belongs with the slice that gives the engine that kind, and is flagged as an open item rather than
   shipped inert. The firm's direct-filing ceiling — the switch that does have an effect — ships here,
   in the administrative lane that already holds the catch-all address.

5. **Undo feedback is derived from the link, not recorded by the unlink route.** The design proposed
   that unlinking an automatic link additionally write a reversal into the ledger. Reading it off the
   link's own state instead — a link a rule made, now `unlinked` — leaves the unlink route's contract
   untouched, cannot be missed by a future path that removes a link without knowing it owed the ledger
   a row, and needs no backfill for links made before the feedback loop existed.

**Considered & rejected:** _evaluating on every capture including entrance-routed ones_ (a rule
overriding a credential or a present member is the mass-file shape); _the gatherer importing the
conflict hook_ (two call sites, and a recorded reason that can disagree with the link); _storing the
DKIM body-coverage bit on the message row_ (a column that is null for every existing row, so the
guardrail fails closed regardless, in exchange for a migration); _shipping the subject-number firm
toggle inert_ (an administrative switch with no effect is a support ticket); _a reversal row written
by the unlink route_ (a second thing every link-removing path must remember, and a backfill).

**Consequences:** the capture route is unchanged — it still stages bytes and enqueues — and the whole
rules pass lives on the queue consumer beside the parse, hash, dedup and thread-link work. A firm with
no rules pays two indexed lookups per capture and writes nothing. The evaluation ledger populates from
the first capture that matches a rule, which is the data a firm needs before it can decide whether to
raise the direct-filing ceiling. Refines
[`email-auto-file-rules`](email-auto-file-rules.md); spec:
[`docs/specs/2026-08-05-auto-file-rules-design.md`](../specs/2026-08-05-auto-file-rules-design.md).
