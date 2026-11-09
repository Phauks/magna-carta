# Auto-file rules for captured email — design

**Date:** 2026-08-05
**Status:** Design proposed; owner decisions in section 13 are open. No product code in this cycle.
**Scope:** What an auto-file rule is, the closed set of rule kinds, the guardrails that decide when a
rule may act without a person, where the consent line falls between staging and filing, the record a
firing leaves behind, the feedback loop that makes a bad rule visible, and where evaluation runs.
Excludes: the user interface (rule creation, the review surface, the correspondence timeline),
notification delivery (an emission point is declared, nothing is wired), machine-learned or adaptive
ranking, mailbox sync, and rule import from another practice-management system — each is a named
later slice or another subsystem's work, with its seam placed here.
**White-paper home:** _Email filing and capture_, with _Matters and File Manager_, _Conflicts_,
_Authentication, access control & encryption_, _Notifications_, _Observability & diagnostics_, and
_Performance & concurrency model_ as surrounding context.
**Governing decisions:** ADR-0195 (the email-filing subsystem architecture — one convergent capture
pipeline, staff-accept by default, guardrailed auto-file named as the fast-follow), ADR-0194 (the
email-filing data model), ADR-0196 (the filing-time conflict hook and the wall-safe already-filed
read), the pending `email-dkim-verdict-informational` fragment (the verdict is informational and
never a filter), ADR-0214 (consensual, guided data conversion), ADR-0068 (trusted-insider access
control; ethical walls are a deferred, named seam), ADR-0067 (route metadata and the one enforcement
chokepoint), ADR-0003 (tenancy and the firm-scoped data-access layer), ADR-0039 (nothing heavy on
the hot path), ADR-0218 (the refusal of a user-authored expression language where a closed set will
do), ADR-0017 / ADR-0038 (audit and redaction), ADR-0064 (the transactional outbox), ADR-0083
(load-profile accretion).
**Decision inputs:** the shipped capture core in `packages/email-filing/src/capture.ts`; the shipped
suggestion ranking in `packages/email-filing/src/matter-suggestion.ts`; the shipped seams in
`packages/email-filing/src/seams.ts`; the shipped verifier in `packages/email-filing/src/dkim.ts`;
the shipped capture consumer in `apps/worker/src/emails/capture-consumer.ts`; the shipped
accept/unlink routes in `apps/worker/src/routes/email/emails.ts`; the shipped add-in client API in
`apps/worker/src/routes/email/email-add-in.ts`; the per-firm schema in
`packages/database/src/per-firm-schema.ts`; and the two prior email-filing designs
([`2026-06-16-email-filing-design.md`](2026-06-16-email-filing-design.md),
[`2026-07-14-email-filing-record-and-forward-capture-design.md`](2026-07-14-email-filing-record-and-forward-capture-design.md)),
whose `autofile_rule` sketch this design either ratifies or overturns line by line.

## Why now

Three things that auto-filing was waiting on have shipped, and one that was assumed to be waiting has
turned out not to exist.

**Shipped:** the capture pipeline itself — forward and CC capture addresses per matter, the firm
catch-all, dedup, the thread DAG, and the staged-link/accept/unlink flow. The matter-suggestion
machinery, with four signals, a confidence grade, an evidence trail in plain language, and an
`ambiguous` flag whose header comment says outright that it exists for the rule that does not exist
yet. The DKIM verifier, with a three-value verdict, eleven reasons, and a settled posture that the
verdict is informational.

**Not waiting on anything:** the guardrails. Every one of them can be built from what is on `main`
today. The filing-time conflict hook is already called at the one site that promotes a link to
`filed`. The wall filter is already the single narrowing point for every matter set the subsystem
hands to a member. The `ambiguous` computation already exists. What is missing is not a signal, it
is the decision about when the platform is permitted to act on signals it already has.

That framing is the whole design. The interesting question is not "can we file this automatically" —
the capture consumer has had everything it needs to do that since the day it shipped, and one
`acceptOnCapture: true` would do it. The question is what must be true before it is allowed to, and
what it owes the firm afterwards.

## 1. What this design is, in one paragraph

An auto-file rule is a **typed, matter-bound, revocable delegation**: a person who could have filed a
message by hand tells the platform to do it for a narrow, named class of future messages. There are
three rule kinds and no expression language. Every firing passes a fixed set of preconditions that are
evaluated in one place and fail closed. The default outcome of a rule is a **staged** link with the
matter already chosen and its reasons attached — not a filed one — because auto-filing is a conversion
of the firm's data that ADR-0214 requires be opt-in and guided; direct filing is a per-rule opt-in
behind a firm policy that is off until an administrator turns it on. Every rule outcome, including
the ones the guardrails suppressed, is recorded with the rule that produced it and the evidence
behind it. Undo is the unlink route that already exists, and undoing an automatic link is the signal
that suspends a rule that keeps getting it wrong.

## 2. What already ships, and what it means for this design

| Shipped thing                                                                              | What it settles here                                                                                      |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `captureEmail` decides `matterId` and `linkState` and commits both in one atomic batch     | A rule decision must be made **before** that commit, not bolted on after, or the link is written twice    |
| The Email Worker entrance always lands `staged`; the API entrance may `acceptOnCapture`    | The staged/filed distinction is already the product's consent line — rules move along it, not around it   |
| `checkFilingConflict` is called at every promotion to `filed` and can hold at `staged`     | The conflict guardrail is not new mechanism; automatic filing traverses the same hook a person does       |
| `rankMatterSuggestions` computes `ambiguous` over tied top scores                          | The concept exists; whether the engine reads that flag or computes a structural equivalent is section 4.1 |
| `filterAccessibleMatters` is the single wall-narrowing point for matter sets               | The access question has one home; the rule engine adds a caller, never a second filter                    |
| `dkim_verdict` + `dkim_verdict_reason` + `captured_via` on every message row               | The identity precondition is readable from the row the capture already wrote                              |
| `email_matter_link` is unique on (message, matter) with a `state` of staged/filed/unlinked | Automatic and manual links are the same rows in the same table; nothing forks the model                   |
| `acceptStagedLinkStatement` / `unlinkEmailFromMatterStatement` and their audit rows        | Accept and undo already exist and are unchanged by this design                                            |

The load-bearing consequence: **this design adds no new filing path.** It adds a decision that runs
before the existing one and can only ever produce values the existing path already produces.

## 3. What a rule is

### 3.1 A matter-bound capture address is already an auto-file rule

`email_capture_address` with `kind = 'matter'` files by construction. A member mints a token, gives
the address to a client or to opposing counsel, and every message sent there resolves to that matter
in the capture consumer with no further judgement. The condition is the address; the credential _is_
the rule; possession of it is the evidence.

Three things follow, and they shape the model more than anything else in this design.

**First, the rule table must not re-express it.** Writing an `email_auto_file_rule` row that mirrors
each capture address would create two homes for one fact, and they would drift the first time a token
is rotated or revoked. The capture address stays exactly what it is; the rule engine reads it as an
input, not as a row it owns.

**Second, it shows that "which matter" and "whether to file" are separable, and that the platform has
already answered them separately.** A matter capture address answers _which matter_ with the highest
confidence available anywhere in the subsystem — a person deliberately created a credential naming
that matter and handed it to a correspondent — and the shipped pipeline still lands the result
**staged**. That is not an oversight. It is the subsystem saying that even a perfect routing answer
does not by itself authorize an unattended filing. Every rule kind below inherits that separation: a
rule carries a routing condition and, independently, a promotion posture.

**Third, it bounds the ambition honestly.** The place auto-file rules earn their keep is not the
add-in (a person is already there, choosing) and not the matter capture address (the matter is
already known). It is the **firm catch-all**, where mail lands today with no matter at all and a
person has to go find one — and, later, **mailbox sync**, where every message arrives unrouted and at
volume. The rule engine is the substrate sync will require. Designing it against the catch-all now is
how sync arrives without a second filing path.

### 3.2 The two questions, and the shape of a rule

A rule answers exactly two:

- **Routing** — which matter does this message belong to? A typed condition matched against the
  captured record.
- **Promotion** — may the resulting link be `filed` rather than `staged`? A per-rule posture,
  defaulting to `stage`, gated by firm policy and by the guardrails in section 4.

Keeping them separate is what makes a "stage it on the right matter, but ask me" rule expressible —
which is both the safe default and, on the catch-all path, a large share of the total value.

### 3.3 The closed set of rule kinds

Three kinds. The set is closed: adding a fourth is a schema and design change, deliberately.

**1. `threadContinuation` — replies in a filed thread.** Condition: the captured message's thread
resolves to exactly one matter that already holds at least one `filed` link. The strongest signal in
the subsystem, and the only one whose evidence is the firm's own prior decision rather than a guess
about the world: somebody already decided this conversation belongs to that matter. It is also the
only kind whose condition strengthens over time rather than decaying — a correspondent changes jobs,
a matter number gets mistyped, but a thread is a thread.

Scope: per matter, created as an opt-in when a member files a message ("keep filing replies to this
conversation here"). Not a firm-wide default, because a firm-wide "all replies auto-file" is
indistinguishable from a policy nobody chose.

**2. `correspondentMatter` — mail from this address, to this matter.** Condition: the captured
message's `From` address, normalized, equals the rule's address. The rule the 2026-06-16 design
called "participant + matter", narrowed on purpose: see section 3.4.

Scope: per matter, per address. The natural creation gesture is the one-tap offer after a manual
filing — "always file mail from this sender on this matter" — which is also how the rule inherits an
authorizing act (section 3.6).

**3. `matterNumberInSubject` — the firm's own number, written in the subject line.** Condition: a
subject token matches a matter number exactly, through the shipped `candidateMatterNumbers` extractor
and an exact-match lookup against the matter-number index. Not a per-matter row at all: it needs no
configuration, because the message names the matter itself. It is therefore a **firm policy toggle**,
not a rule table entry, and the recommendation in section 13 is that it default to off and be
stage-only.

### 3.4 What is refused, and why

**Regex and keyword subject rules — refused.** The 2026-06-16 sketch allowed "subject matter-#/keyword"
and called it safe. Half of it is; the other half is a foot-gun in four separate ways, and they
compound. A regex authored by a member is an evaluator running attacker-influenced input inside the
capture path, with catastrophic-backtracking behaviour that is not obvious from reading the pattern. A
substring keyword matches inside words nobody intended — a rule for "Smith" files the newsletter
about locksmithing. Neither can be rendered as the plain sentence the evidence trail owes the person
reviewing it: "the subject matched `/(?:re:\s*)?smith.*/i`" is not a reason, it is a restatement. And
crucially, the guardrails in section 4 have to know what a rule _means_ in order to reason about
competing evidence; a pattern has no meaning beyond "it matched". Exact matter-number match keeps
everything the keyword rule was reaching for and gives up nothing that can be explained.

**Sender-domain rules — refused,** despite the 2026-06-16 sketch permitting them "flagged risky". The
objection is not that they are risky in operation but that they are self-defeating in principle. A
domain is one-to-many by construction: the counterparties whose domains a firm would want to write
rules for — a bank, an insurer, a large opposing firm, a court — are precisely the ones corresponding
about many matters at once. So the rule's own condition guarantees that the ambiguity guardrail
suppresses it exactly where a firm has enough volume to want it, and permits it only in the
degenerate case where a domain has one correspondent, which `correspondentMatter` already covers with
a precise condition. A rule that is either suppressed or redundant is not a rule kind, it is a
support ticket.

**A rule expression language — refused,** on the precedent ADR-0218 set for template expressions. A
combinator grammar ("from this domain AND subject contains X, unless CC includes Y") is a new
evaluator with its own semantics, its own failure modes, and its own audit problem, in exchange for
expressiveness that the guardrails would then have to defeat case by case. Three typed kinds, each
one comparison, is the ceiling.

**Rules that file across matters in bulk, or that act on already-captured mail — refused.** A rule is
forward-looking only. It never sweeps the archive, and creating one never retro-files anything. A
person who wants the last six months filed can select and file them, which is a different act with a
different consent shape.

### 3.5 Firm rules, member rules, and who may create which

Two tiers, split on whether the rule names a matter.

**Matter-scoped rules** (`threadContinuation`, `correspondentMatter`) are created by a member who can
access the target matter. The authorizing capability is the delegation of an act they can already
perform: `emails:manageLinks` is what lets a member accept a staged link onto a matter, and a rule is
that same act, delegated forward. Because a rule is durable and acts unattended and on behalf of
people who did not create it, the recommendation in section 13 is a **separate capability**,
`emails:manageAutoFileRules`, rather than a widening of `emails:manageLinks` — so a firm can grant
"you may file mail" without also granting "you may configure the machine to file mail." Seeded to
Owner/Admin and Attorney; Paralegal by firm grant.

**Firm-scoped policy** — whether direct filing is permitted at all, and whether
`matterNumberInSubject` is on — is administrative, in the lane that already holds
`emails:manageCaptureAddresses` (Owner/Admin only). The firm-level switch is a **ceiling, not a
default**: with it off, every rule in the firm stages regardless of its own posture. This is the
structural expression of the consent posture in section 5 — an individual member cannot opt the firm
into unattended filing.

**Visibility mirrors matter access.** A rule naming a matter is visible to whoever can see the matter,
through the same filter every other matter-set read uses. There is no firm-wide rule list that shows
matters the reader cannot access — a rule list would otherwise be exactly the existence oracle
ADR-0196 went to some trouble to close on the already-filed read.

### 3.6 Rules are learned from real filing, not authored in the abstract

Ratifying the 2026-06-16 position, and it matters more under this design than it did under that one:
the rule creation gesture is the offer made **after** a member files a message by hand — "file replies
to this conversation here", "always file mail from this sender here" — with the abstract editor
existing for the person who wants to see and prune the list.

The reason is not user-interface taste. It is that a rule created from a filing inherits an
authorizing act that the guardrails can point at: a specific person, with access to that matter, made
that exact filing decision on that exact evidence at a recorded moment. That provenance is what the
rule record stores as its justification, and it is what makes an audit of "why did this file itself"
terminate in a human decision rather than in a configuration screen.

## 4. The guardrails are the design

Everything above is the small part. A rule kind is a comparison; the guardrails are what make an
automatic comparison safe to act on. They are stated as preconditions on **promotion and routing**,
evaluated in one pure function, and they fail closed: any precondition that cannot be evaluated
counts as not satisfied.

The failure mode being defended against is specific and has happened to competitors at scale — the
wrong-matter mass-file, where a rule with a broad condition quietly files hundreds of messages onto
the wrong matter, and the firm discovers it when privileged material is produced to the wrong party.
Every guardrail below is aimed at some part of that sentence.

### 4.1 Never fire on ambiguity

The rule is: **a firing requires exactly one matter to be named by the high-precision evidence, and
that matter to be the rule's target.**

Concretely, evaluation gathers the same evidence the suggestion endpoint gathers, then partitions it:

- **Deciding evidence** — matched rules, thread continuation, and exact subject matter-number. Each
  of these names a matter on a precise, checkable ground.
- **Non-deciding evidence** — correspondent-is-a-party, and the typed search term. The first
  accumulates by design (one person is a party on many matters, which is why the ranking caps its
  contributions at three); the second does not exist off the request path at all.

If the deciding evidence names more than one distinct matter — two rules disagreeing, a rule pointing
at one matter while the subject line names another, a thread that resolves to two matters — nothing
fires. The capture lands staged, with all of the candidates attached as suggestions, which is
precisely the state a person is equipped to resolve and the machine is not.

**Why this is computed structurally rather than read off `ambiguous`.** The shipped flag is true when
two candidates tie on _score_, and the score is a sum of tuning constants. Making the decision to file
depend on those constants means that a future adjustment to the ranking weights — a change to how a
suggestion list is _ordered_ for a human — silently changes which messages file themselves. That
coupling is unacceptable for an unattended act. The structural test ("how many distinct matters does
the deciding evidence name?") is the same idea expressed in a form that cannot be moved by a tuning
change, and it is strictly more conservative: any tie on the shipped scoring is also a multi-matter
answer here. `ambiguous` keeps its job, which is telling a client not to pre-select.

### 4.2 Never across a wall, and the honest answer on access

The task poses the natural formulation: a rule fires at most into matters its creator could see at
creation _and_ the mail's recipients could see at fire time. The first half is right and incomplete;
the second half should be rejected outright.

**Creation-time access is necessary but not sufficient.** A rule is a delegated act, so it may only
ever name a matter its creator could access when they created it — that is what makes it a delegation
rather than an escalation. But access is withdrawn as well as granted, and the shipped code already
takes this seriously in a lower-stakes place: the filing-context read re-filters a member's own past
filing targets on every request, with the comment that "access can be withdrawn after the fact, and a
shortcut list is not an exemption from the current answer." A durable rule that keeps firing for a
member who has been walled off the matter is the same mistake with a longer half-life. So: **the
rule's creator must still hold access to the matter at fire time.** A rule whose creator no longer
does is _suspended_ and surfaced for an administrator, not deleted (section 13, flag F6) — deletion
destroys the audit trail of what had been firing.

**The recipients test is the wrong test.** The "mail's recipients" are correspondents: clients,
opposing counsel, courts, vendors. Most have no platform identity, so the test is unsatisfiable for
the majority of inbound mail — and the mail most worth filing, a letter from opposing counsel, would
be exactly the mail that could never fire. Worse, it inverts the direction of the obligation: whether
an external party can see a matter is not a fact the platform knows or should model, and inventing an
answer to it would be inventing an access claim about people the firm has no account for. Where a
_firm member_ is a recipient the question is answerable, but it is still the wrong question: a member
being CC'd on a message does not authorize or deauthorize filing it, and firms routinely file
correspondence that a walled-off member happened to be copied on.

**What replaces it is already built.** The consequence a wall actually cares about is disclosure: a
message filed onto a matter becomes visible to that matter's cohort. That is the same act a person
performs when they accept a staged link, and it already traverses `checkFilingConflict`, which can
hold the link at `staged`. So automatic filing gets the guardrail for free by using the same path:
**a conflict or wall hold suppresses promotion and lands the link staged**, exactly as it does for a
manual accept, and when the conflicts engine drops in behind that hook it protects automatic and
manual filing identically with no second integration. A fitness function should assert that the
automatic promotion path cannot reach `filed` without traversing the hook — the same assertion the
seam comment already anticipates.

Two smaller access rules complete it: a rule may not name the platform-owned holding matter, and a
rule may not name a matter in a closed or archived state (section 4.5).

### 4.3 DKIM: a rule input, not a change of verdict posture

The pending decision on DKIM says the verdict is informational and "no message is dropped,
quarantined, refused, or auto-filed on the strength of it." Reading that as forbidding a DKIM
precondition here would be a misreading, and the distinction is worth stating precisely because it
will be asked again.

The posture protects **the message and the record**: nothing the verifier says may cause a message to
be lost, refused, hidden, or degraded, and nothing it says may cause a message to be _filed_. Every
item in that list is a way the verdict could make the platform's treatment of the firm's mail
_worse_ or _more automatic_. A precondition on unattended promotion runs the other way: it can only
ever make the platform _less_ automatic. Under it the message is still captured, still parsed, still
deduplicated, still recorded with the same verdict and the same reason, still suggested to the member
with the same evidence, and still one click from filed. Nothing is withheld from the firm; what is
withheld is the machine's permission to act unaccompanied.

So the correct framing is: **the verdict does not gate the record, it gates the robot.** That is a
rule input, and the verdict's posture is unchanged. (This design nonetheless recommends the point be
recorded explicitly in the decision fragment, because the sentence "never a gate" is exactly the sort
of thing that gets quoted at a future reviewer without its subject.)

The precondition binds **only where a rule's condition is an identity claim**, and only where the
question is answerable:

| Rule kind               | DKIM precondition                                                                                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `correspondentMatter`   | Requires a capture carrying an intact original (`captured_via` of `addin`, later `sync`), a verdict of `pass`, and the verified domain matching the rule address's domain. Otherwise no fire. |
| `threadContinuation`    | No positive requirement — its condition is not a claim about who sent the message. But a verdict of `fail` on an intact-original capture suppresses it.                                       |
| `matterNumberInSubject` | Same as thread continuation: `fail` on an intact-original capture suppresses.                                                                                                                 |

The asymmetry is the point. `correspondentMatter` is the only kind whose condition is "this message
came from this person", and `From` is trivially spoofable; a rule that files on an unauthenticated
`From` is a mechanism for a stranger to insert a document into a matter file. The other two rest on
conditions a stranger cannot cheaply forge into a useful outcome: continuing a thread requires
knowing a `Message-ID` the firm holds, which in practice means already being on the conversation, and
naming a matter number requires knowing the firm's numbering — and in both cases the payoff of a
successful forgery is that the message lands in the matter it claims to belong to, which is where a
successful attacker's message would go anyway.

The `unverified` verdict is treated as "no answer", never as "no". Unsigned internal mail, a rotated
selector, a resolver outage, and a `.msg` export with no signable octets all land there, and treating
them as failures would suppress the ordinary case. Only `fail` — the verifier put the question and
the cryptography said no — suppresses.

**The forwarded-capture consequence, stated plainly.** Forwarding rewrites headers and breaks the
original signature, so a forward or catch-all capture can essentially never carry a `pass`. Under
this rule `correspondentMatter` therefore never fires on the forward/CC path. That is not a gap to
close later; it is the guardrail working. On that path the platform cannot tell who sent the message,
only who forwarded it, so a rule that trusts sender identity has nothing to stand on. Thread
continuation and subject matter-number both remain available on the forward path, which is what makes
the catch-all case (section 3.1) still work.

### 4.4 Never over a human decision

If the message is a dedup hit that a person has already filed or unlinked anywhere, no rule fires.
Three sub-cases, all resolving the same way:

- Already `filed` to the rule's target matter — nothing to do; the unique index would reject a second
  link anyway.
- Already `filed` to a _different_ matter by a person — do not add a second link automatically. A
  message legitimately belongs to several matters, but "a person filed this to Matter A and the
  machine also put it on Matter B" is the shape of the failure this design exists to prevent, and the
  suggestion machinery is right there to propose it instead.
- Previously `unlinked` from the rule's target matter — a person actively removed it. A rule must not
  put it back.

This guardrail costs one bounded read of the message's existing links, which the dedup path has
already performed.

### 4.5 Never into a matter that is not open

A rule naming a closed, archived, or otherwise non-active matter is suspended rather than fired. This
is cheap, it prevents the common stale-rule case (a matter concluded and nobody pruned the rules), and
it makes the suspension list a natural review surface at matter close.

### 4.6 The blast bound

The single most valuable guardrail against the mass-file failure mode, and the one no competitor
appears to have: **a rule that fires more than a threshold in a rolling window trips a circuit breaker,
reverts to staging, and surfaces.** A mailing list added to a correspondent rule, a bounce loop, an
autoresponder, a newsletter from a client's domain — every one of them shows up as an unusual firing
rate before it shows up as a hundred wrongly-filed messages.

Recommended thresholds in section 13 (flag F7). The point is that the breaker exists and is a property
of the rule rather than an operations alert: the rule stops filing on its own, and a person is asked.

### 4.7 One function, failing closed

All of the above is one pure decision function in `@magna-carta/email-filing`, taking gathered
evidence and returning one of three outcomes — `file`, `stage`, or `noRule` — plus the reasons. It
follows the shape `rankMatterSuggestions` already established: the caller gathers with firm-scoped
reads, the pure function decides, and the decision is testable without a database.

Failing closed is structural, not a coding convention: the return type's default arm is `stage`, an
unevaluable precondition produces a suppression reason rather than an exception, and a thrown error
anywhere in gathering degrades the capture to exactly what it does today — staged, or unrouted. A
capture is never lost because a rule could not be evaluated.

## 5. Consent posture: staged by default, direct by explicit opt-in

**The verdict: an auto-file rule lands a STAGED link by default, with per-rule opt-in to direct
filing, itself gated behind a firm-level policy that is off until an administrator turns it on.**

The argument from ADR-0214, whose three rules map onto this feature almost mechanically:

**Detection and reporting are always on.** The engine evaluates and records what it would have done
even where nothing is enabled to act — a rule that is stage-only still records that it matched, and a
suppressed match still records why it was suppressed. This is what makes a firm's decision to enable
direct filing an _informed_ one: they can see what the rules have been proposing and how often a
person agreed, before granting them the ability to act. A consent posture where the first data a firm
has about a mechanism arrives after they enable it is not consent, it is a leap.

**Conversion is opt-in.** Filing a message onto a matter is a durable, consequential placement of the
firm's data — it determines what appears in that matter's correspondence record, what a bulk download
contains, what a discovery export sweeps up, and who can see it. Doing that on arrival, unattended, is
exactly "a silent side effect of an upload", which is the thing the posture names. So direct filing
requires two explicit acts by two different kinds of principal: an administrator enabling it for the
firm, and a member choosing it for a specific rule.

**Input, guidance and feedback at the decision.** Rule creation states what the rule will do and what
it will not (the guardrails that apply to that kind, including the DKIM asymmetry, in the offer
itself). Every outcome is reported with its rule and its reasons. And the fire/undo counters close the
loop — the platform tells the firm how a rule has actually been behaving, not just that it exists.

**Why not direct-with-visible-undo as the default,** which is the honest alternative and is what most
competitors do: undo is only visible to someone who looks. A staged link makes the human step the
default path and the automatic step the exception, which is the direction the whole subsystem already
leans — the Email Worker entrance hardcodes `staged`, the conflict hook's response to any doubt is to
demote to `staged`, and the shipped user documentation says in as many words that "every capture lands
staged for someone to confirm onto the matter — nothing is silently auto-filed to the wrong place."
Reversing that default would make that sentence false for every firm by default, rather than false
only for a firm that deliberately chose it. (Documentation obligation for the build slice: that
sentence needs a conditional clause once direct filing exists, and the user guide is the one home for
it.)

**Why a staging rule is not toothless,** which is the fair objection: on the add-in path a staging
rule adds little, because a person is already there choosing. But on the catch-all and forward paths
it converts "captured, unrouted, someone must find the matter" into "captured, staged onto the right
matter, with reasons, one click from filed" — and that is most of the value at most of the volume.
The suggestion machinery cannot do this: it answers a question asked from a mail client, and on the
catch-all path nobody asked.

**The one place direct filing is plainly right** is `threadContinuation` on a matter where a member
has explicitly said "stop asking me about replies to this conversation". The condition is the firm's
own prior filing decision, the guardrails are strongest there, and the alternative is a member
clicking accept on the same thread forty times. That is the case the opt-in exists to serve, and it is
why the answer is not simply "never file directly."

## 6. The data model

Two new per-firm tables and one nullable column on a shipped one. Names spelled out in full.

**`email_auto_file_rule`** — one row per matter-scoped rule.

| Column                          | Notes                                                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `id`                            | `emailAutoFileRule_` handle                                                                                |
| `kind`                          | `threadContinuation` \| `correspondentMatter`; CHECK-constrained                                           |
| `matter_id`                     | Required. A rule always names exactly one matter                                                           |
| `match_value`                   | The normalized `From` address, or the `email_thread` identifier. One column, meaning fixed by `kind`       |
| `promotion`                     | `stage` \| `file`, default `stage`                                                                         |
| `state`                         | `active` \| `suspended` \| `revoked`; CHECK-constrained                                                    |
| `suspended_reason`              | Why, when suspended: `creatorAccessWithdrawn`, `matterClosed`, `blastBound`, `undoRate`, `member`          |
| `created_by`                    | The delegating principal. Not decorative — section 4.2 re-checks this member's access at every fire        |
| `created_from_email_message_id` | The manual filing that occasioned the offer, when there was one — the rule's authorizing act (section 3.6) |
| `created_at` / `updated_at`     | Standard                                                                                                   |

Indexes: unique on `(kind, match_value, matter_id)` so the same rule cannot be created twice;
`(kind, match_value)` for the fire-time lookup, which is why evaluation cost does not scale with the
firm's rule count; `(matter_id)` for the matter's rule list; `(state)` partial for the suspension
review.

**`email_auto_file_decision`** — the evaluation ledger, and the detection half of ADR-0214.

One row per capture **where something happened**: at least one rule matched, or a match was
suppressed by a guardrail. A capture that no rule looked twice at writes nothing, which is what keeps
this table proportional to rule activity rather than to mail volume. Columns: the message, the rule
(nullable — a suppression can be attributable to evidence rather than to one rule), the outcome
(`filed`, `staged`, `suppressed`), the suppression reason from a closed enum matching section 4's
guardrails, the deciding evidence as a small identifier-and-enum structure, and the created instant.

**No message content of any kind lands here** — not the subject, not an address, not a display name.
The reason enum, the matter identifiers, and the rule identifier are the whole record, on the same
rule the capture's idempotency body already follows ("identifiers and enums only"). The plain-language
reasons a person reads are rendered from those identifiers at read time, by the same phrasing table
the suggestion machinery uses.

**`email_matter_link.auto_file_rule_id`** — nullable, on the shipped table. Null means a person made
this link. Non-null means the machine did, and names which rule. This is the fact every read needs and
the only one that has to live on the link itself; everything richer is a join to the decision ledger.
An expand-only column addition, no rebuild.

**Rejected: counters on the rule row.** `fire_count` and `undo_count` as maintained columns would put
a write on the capture hot path and a second one on the unlink path, both contended for a busy rule,
in exchange for a number the decision ledger can produce from a bounded index walk off the request
path. The one piece of state that _is_ materialized is `state`/`suspended_reason`, because that is a
decision the engine must read cheaply at fire time, not a statistic.

## 7. Audit, undo, and the feedback loop

**Every automatic link carries its evidence.** The link row names the rule; the decision row names the
outcome, the guardrails consulted, and the deciding evidence. Rendering "why did this file itself"
requires no re-derivation and no re-parse — which matters, because the question is usually asked
weeks later when the message has been superseded and the correspondent's party role has changed.

**Audit rows follow the shipped pattern exactly.** `emails.autoFiled` and `emails.autoFileStaged`,
written through `domainAuditStatement` in the same batch as the link, with `metadata` carrying
identifiers only (matter, rule) — matching `emails.filed` and `emails.unlinked`, which already carry
`{ matterId }` and nothing else. The redaction rule is not restated here; it is inherited.

**Undo is the existing unlink route, unchanged.** No new endpoint, no automatic-link-specific
reversal path. `DELETE /api/v1/matters/{matterId}/emails/{emailMessageId}` already flips the link to
`unlinked`, writes its audit row, and never deletes the message. The one addition is that unlinking a
link whose `auto_file_rule_id` is non-null also records a reversal against that rule in the decision
ledger — the feedback signal.

**The feedback loop closes on undo rate.** Per rule, derived from the decision ledger: fires, undos,
first and last fire. A rule whose recent firings are being undone at a rate over the threshold
suspends itself (flag F7), which is the same mechanism as the blast bound with a different input.
Suspension is not deletion: the rule stays visible with its reason, because a suspended rule with a
history is diagnostic and a deleted one is a mystery.

**The review surface** is the "auto-filed — review" read the 2026-06-16 design named: recent automatic
links, their rules, and their undo rates, filtered to the reader's accessible matters. This design
specifies the read; the surface that renders it is not built here.

## 8. Execution point, and the bound

**Where.** In the capture consumer (`apps/worker/src/emails/capture-consumer.ts`), off the request
path, where filing already happens. Specifically: evaluation runs **inside** `captureEmail`, at the
point where `matterId` and `linkState` are decided, reached through a new optional port on
`CapturePorts` alongside `resolveDirectoryEntities` and `verifyDkim`.

That placement is deliberate and the alternatives are worse. Evaluating _after_ the capture commit
means a second write and a second idempotency problem, and a window in which the message is filed
nowhere. Evaluating in the entrance means doing it twice, in two places, one of which (the Email
Worker) has no per-firm database handle at all. Inside `captureEmail` the automatic link rides the
existing atomic batch, the existing idempotency record already reports `linkState` back to a polling
client with no change, and a redelivery replays the identical decision instead of re-deciding.

**The port keeps the core pure.** `resolveAutoFileDecision?(input): Promise<AutoFileDecision>` — the
port gathers with firm-scoped reads, the pure guardrail function decides. An absent port means no
rules, which is exactly today's behaviour, and is what every existing test continues to exercise.

**The bound.** Per capture, at most five additional statements, every one a bounded index walk, none
inside a loop:

1. Rules matching the normalized `From` address — one lookup on `(kind, match_value)`.
2. Rules matching the resolved thread — one lookup on the same index.
3. The thread's filed matters — `readFiledMattersForThreads`, already shipped and already used by the
   suggestion endpoint.
4. Subject matter-number candidates — `findMattersByNumbers` over the bounded
   `candidateMatterNumbers` output, already shipped, capped at twelve parameters.
5. The message's existing links plus the target matters' status and the creators' access, resolved
   together.

Cost does not scale with the firm's rule count (the lookup is by match value, not a scan), with the
firm's mail volume (per message, fixed), or with thread length (the thread lookup is by identifier).
The suggestion endpoint already performs items 3 and 4 within a request budget, so doing them on a
queue consumer is strictly cheaper than what ships today.

**No rule engine.** No DSL, no interpreter, no user-supplied predicate. A closed set of typed kinds,
each one comparison, evaluated by ordinary code — which is also what makes the guardrails able to
reason about what a rule _means_ rather than only that it matched.

## 9. The API surface

Six operations, all through the chokepoint with full route metadata, all `resource: "matter"` on the
`emails:*` precedent.

**Writes** (`emails:manageAutoFileRules`, subject to flag F5): create a rule (from a filing, or
directly), update its promotion posture, suspend or resume, revoke. Idempotency-keyed. Each writes an
audit row.

**Reads** (`emails:read`): the rules on a matter, and the review read — recent automatic links with
their rules and undo rates, narrowed through `filterAccessibleMatters` before hydration, on the same
discipline the suggestion endpoint documents at length.

**Firm policy** (the administrative lane, Owner/Admin): whether direct filing is permitted at all, and
whether `matterNumberInSubject` is enabled. The `scan-policy` routes in the worker are the working
precedent for a firm-settings pair, down to the resolved-defaults read shape.

## 10. Load profile and measurement

Four measurements, on the ADR-0083 accretion rule — added to the existing corpus, not a new harness:

1. **Capture with rules enabled versus without**, on the shipped capture fixtures. The delta is the
   five statements in section 8, and the budget is that it stays a small fraction of the parse and
   hash cost that already dominates the consumer.
2. **A firm with a large rule population** (ten thousand rules across a thousand matters) — asserting
   the flat cost claim, since it is the one that would quietly become false if a lookup ever became a
   scan.
3. **A thread with a long history** — asserting that thread-continuation evaluation is by identifier
   and does not walk the thread.
4. **The blast bound under a burst** — a hundred messages matching one rule inside the window,
   asserting the breaker trips and the subsequent captures stage rather than continuing to file.

## 11. Named seams, not built here

**Notifications.** `raiseEmailFiledNotification` already exists as a no-op raise site in
`packages/email-filing/src/seams.ts`, and an automatic filing raises it exactly as a manual one does.
Two emission points are _declared_ and not wired: "a rule was suspended" and "the review digest is
ready". Nothing in this design delivers a notification.

**Mailbox sync.** The `sync` value already exists in `captured_via` and in the rule engine's DKIM
table. Sync is where auto-file rules become load-bearing rather than convenient, and building the
engine against the catch-all path now is what stops sync from arriving with a filing path of its own.

**The conflicts engine.** Drops in behind `checkFilingConflict` and protects automatic and manual
filing identically, with no call-site change here.

**Ethical walls.** Enforcement lands behind `filterAccessibleMatters`; this design adds callers, never
a second filter.

**Machine-learned ranking.** Explicitly not built and not seamed. The rule kinds are typed comparisons
whose evidence is explainable in one sentence; a learned ranker's output is not, and an unattended
filing whose justification is a weight vector cannot be audited by the person who has to answer for
it.

**The user interface.** Rule creation offers, the rule list, the review surface, and the suspension
review are all named and none is built.

## 12. Seams to work in flight

Run `vp run worktrees` before the build slice; at design time the overlaps are:

- **The email add-in client API stream** owns `packages/email-filing/src/matter-suggestion.ts` and
  `apps/worker/src/routes/email/email-add-in.ts`, and lands an index-only per-firm migration. This design
  adds no change to either file — the rule engine gathers its own evidence — but the build slice's
  migration ordinal reconciles against whatever that stream lands.
- **The case calendar design** registers `email_matter_link` as a federated timeline source. An
  automatic link is a link, so it appears on the timeline with no registry change; whether the
  timeline distinguishes automatic from manual is a rendering question for that surface.
- **The per-firm migration lineage** is the usual collision point: this design names three schema
  changes (two tables, one column) and the ordinal is assigned at build time.

## 13. Owner decisions required

| Flag   | Decision                                                                                                                                                                                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F1** | **Staged by default, or direct filing with visible undo?** Recommended: **staged by default, per-rule opt-in to direct filing, behind a firm policy that is off until an administrator enables it** (section 5). The design's central call.                                                                    |
| **F2** | **Does `correspondentMatter` match the `From` address only, or any participant?** Recommended: **`From` only.** A CC'd address is not a statement about what a message is about, and participant-anywhere matching is how a client copied on a mailing list mass-files the list onto their matter.             |
| **F3** | **Is the DKIM precondition a change to the verdict's informational posture?** Recommended: **no — it gates the robot, not the record** (section 4.3), applied asymmetrically: `pass` plus an intact original required for `correspondentMatter`; `fail` on an intact original suppresses the other kinds.      |
| **F4** | **Is `matterNumberInSubject` an auto-file kind at all?** Recommended: **yes, as a firm policy toggle, default off, stage-only.** It needs no per-matter configuration and it is precise, but a subject line is written by whoever sent the message, so it should never promote unattended.                     |
| **F5** | **A new `emails:manageAutoFileRules` capability, or reuse `emails:manageLinks`?** Recommended: **new capability**, seeded to Owner/Admin and Attorney, Paralegal by firm grant. "May file mail" and "may configure the machine to file mail" are different grants, and a firm should be able to separate them. |
| **F6** | **A rule whose creator loses access to the matter: suspend or revoke?** Recommended: **suspend and surface**, never delete. A suspended rule with its history is diagnostic; a deleted one leaves the firm unable to explain what had been filing.                                                             |
| **F7** | **The circuit-breaker thresholds.** Recommended: **twenty-five fires per rule per rolling hour**, and **three undos within the last ten fires** — either trips the rule back to staging and surfaces it. Not correctness-critical, but user-visible and better fixed than discovered.                          |
| **F8** | **May a rule fire on a message a person has already filed or unlinked elsewhere?** Recommended: **never** (section 4.4). The one guardrail that is purely about not contradicting a human, and the cheapest to implement.                                                                                      |

## 14. Open questions

1. **Whether a `threadContinuation` rule should be implicit rather than a row.** A firm could
   plausibly want "replies to any filed thread stage onto that thread's matter" as a policy, with no
   per-thread rule at all — the condition is self-evidencing and the guardrails apply the same way.
   Leaning towards keeping it an explicit per-matter row for the first build, because an implicit
   firm-wide rule has no creator to re-check access against (section 4.2), which would mean inventing
   a different authorization story for one kind.
2. **Whether the decision ledger needs a retention sweep.** It writes only on rule activity, so a firm
   with ten rules writes very little and a firm with a thousand writes proportionally more. Probably
   bounded enough to leave alone; noted so it is measured rather than assumed.
3. **Whether a rule should be able to name more than one matter.** Mail from a client who is a party
   on three related matters genuinely belongs on all three. But a multi-matter rule fires three
   filings from one condition, which multiplies the blast radius of a wrong rule by three, and the
   ambiguity guardrail exists precisely to refuse the case where the answer is not singular. Leaning
   no; recorded rather than resolved.
4. **Whether an offer to create a rule should be made after the first manual filing or the third.**
   Offering immediately is discoverable and risks a rule created from a one-off; offering on a
   repeated pattern is better evidence and worse discovery. A user-interface question with a data
   dependency, so it is noted here rather than settled.
