---
number: 387
slug: a-rule-that-cannot-act-is-refused-at-creation-not-stored-and-ignored
status: Proposed
date: 2026-08-19
area: Email
summary: "The auto-file rule management surface refuses at creation every rule the guardrails could only ever suppress, rather than storing it and letting it fail silently at fire time. Three refusals carry it: a rule asking to file while the firm's direct-filing ceiling is down is rejected outright, because storing the posture would tell the member who set it that their firm had opted into unattended filing — which is the one act the ceiling exists to reserve for an administrator; a thread-continuation rule is rejected unless its conversation is already filed to the named matter, because its whole claim is the firm's own prior decision and without a filed link that claim is false; and a rule naming a matter that is not open is rejected, because the matter-state guardrail would suppress it forever with no way for the firm to see why. The review read narrows its matter set through the single wall filter BEFORE it reads any rule and carries no cursor, since narrowing a paged set hands out short pages and calls them the end of the list; and its per-rule counts are derived from the links themselves rather than the decision ledger, so the reviewer's numbers and the circuit breaker's undo input cannot tell a firm two different stories about one rule. A partial index over the automatic links is added because the shipped undo derivation subqueries an unindexed column on the capture path."
---

**A rule the guardrails could only ever suppress is refused when it is created, not stored and
ignored.**

**Context:** The auto-file guardrail function, the port on the capture core and the evidence gatherer
in the capture consumer all shipped. Nothing in the product created a rule — the create statement's
only caller in the repository was a test — so the engine ran on every unrouted capture, matched an
empty candidate set, and returned. The management surface is what makes the engine reachable, and
building it forced a question the engine never had to answer: what happens when somebody asks for a
rule whose conditions the guardrails will never let it act on.

The engine's own answer is to suppress and record. That is right at fire time, where the alternative
is losing a capture. It is wrong at creation time, where the alternative is telling the person the
truth while they are still there.

**Decision:**

**1. A rule that asks to file while the firm's ceiling is down is refused, not stored.** The ceiling
is the structural expression of the consent posture: with it down, every rule stages whatever its own
posture, so no individual member can opt the firm into unattended filing. Accepting `promotion: file`
under that ceiling and quietly staging would satisfy the letter of that and defeat its point — the
member who set the rule would believe their firm had opted in, and would find out otherwise only by
noticing that nothing ever filed. The refusal names the ceiling and says who can raise it. The same
refusal binds the promotion edit, so the posture cannot be reached in two steps either.

**2. A thread-continuation rule is refused unless the conversation is already filed to the named
matter.** This kind is the strongest signal in the subsystem for exactly one reason: its evidence is
the firm's own prior decision rather than a guess about the world. A rule created over a conversation
nobody has filed there has no such decision behind it — it is an ordinary guess wearing the strongest
signal's clothes, and the guardrails cannot tell the difference because by the time they run the rule
simply exists. Checking it at creation is cheap (one bounded read the suggestion machinery already
issues) and it makes the creation gesture what the design says it is: a member saying "keep doing
what I just did", rather than a member asserting something the firm has not done.

**3. A rule naming a matter that is not open, or one the platform owns, is refused.** The fire-time
guardrail suppresses on matter state and suspends the rule, which is the right treatment for a matter
that CLOSED while a rule was running. A rule created on an already-closed matter would be suspended
on its first eligible capture and never before, so the firm's list would carry a rule that had never
worked and could not say why.

**4. The review read narrows before it hydrates, and carries no cursor.** The matter set passes
`filterAccessibleMatters` before a single rule row is read, so a rule on a matter the caller cannot
open contributes no entry, no count and no suspension line — it never enters the answer rather than
being filtered out of one. The window is thirty days and unpaged deliberately: narrowing is only sound
over a set that is not paged, because a cursor over a set a wall can shrink hands out short pages and
calls them the end of the list. A read that must page and must narrow needs a different design, and
this read needs neither.

**5. The review's counts come from the links, not from the decision ledger.** A link a rule made,
now `unlinked`, is a reversal — the same derivation the circuit breaker's undo input already uses,
which is what stops the number a firm reads in the review and the number that trips the breaker from
being two different answers about one rule. It also needs no second statement per rule: the counts
fall out of the page already read.

**6. A partial index over the automatic links.** `readAutoFileRuleActivity` subqueries
`email_matter_link.auto_file_rule_id` with no index behind it, which is a scan of every link the firm
holds, issued on the capture path the moment a rule matches. The index is partial —
`WHERE auto_file_rule_id IS NOT NULL` — so a firm with no rules carries an empty one, it grows with
rule activity rather than with mail volume, and it serves the review read as well.

**Considered and rejected: accepting `promotion: file` under a lowered ceiling and reporting the
effective posture in the response.** It reads friendlier and it is how most settings surfaces behave.
It is refused because the two postures differ in what they mean rather than in what they do: a stored
`file` under a raised ceiling is a member's choice taking effect, and a stored `file` under a lowered
one is a member's choice waiting to take effect the moment an administrator does something unrelated.
The second is a rule that arms itself later, without anybody deciding to arm it.

**Considered and rejected: a cursor on the review read, with the wall filter applied per page.** The
narrowing rule the subsystem keeps — narrow before hydration, never after paging — exists because the
two compose badly, and the failure is quiet: the reader gets a short page and reads it as the end.

**Considered and rejected: deriving the review's counts from the decision ledger.** The ledger is the
richer record and it is the wrong one here. A decision row says what was decided; a link says what is
currently true, and a reviewer asking "what has this rule been doing" is asking the second question.
Two derivations of one number is also how a surface and a guardrail come to disagree in front of a
firm.

**Consequence:** eight operations join the contract — `emails.createAutoFileRule`,
`emails.listAutoFileRules`, `emails.updateAutoFileRule`, `emails.suspendAutoFileRule`,
`emails.resumeAutoFileRule`, `emails.revokeAutoFileRule`, `emails.autoFileDecisions`,
`emails.autoFileReview` — with four new problem types and one index-only per-firm migration. The
`emails:manageAutoFileRules` capability acquires its first enforcement point, so the separation it was
seeded for becomes real: a Paralegal holds `emails:read` and `emails:manageLinks` and may now read a
matter's rules and not configure one. No user interface ships with this. The subject-number firm
toggle remains unbuilt and remains an open item for the slice that gives the engine that rule kind.
