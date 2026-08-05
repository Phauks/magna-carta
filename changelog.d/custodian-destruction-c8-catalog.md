---
category: Added
---

Custodian — the destruction workflow, and the first jurisdiction in the will-deposit duty catalog.

**Destroying a client's original now takes two people, and it takes them by construction.** A person
raises a request naming the packet or one item inside it and writing down the reason and the authority
they assert; a **different** person approves it; a third call records that it was carried out. The
requester and the approver being two people is enforced at the database by triggers as well as by the
service — including the case a column check cannot see, where a request records no requester at all
and any approver would otherwise satisfy it. A request that has been refused, executed, or withdrawn
is terminal: it is re-raised, never re-decided. Execution appends a `destroyed` entry through the
register's one movement write path, so the destruction of a client's property carries a person's name
on the same append-only ledger every other event does, and the request row records which ledger entry
it produced.

**Two refusals have no override anywhere on the surface.** A hold in force forbids both raising the
request and carrying it out — asked twice, because a hold placed in the window between them is exactly
what a hold is for. And an item recorded as an irreplaceable original is **never** destructible: there
is no force flag, no override field, no privileged caller, and no second endpoint. That refusal now
also binds the ordinary movement path and the database itself, so it holds for a write path nobody has
built yet; the only way an original becomes destructible is for a person to change the record about
that specific object, which is a deliberate, audited change to a fact rather than a way around a rule.
Still deliberately absent: any retention period, default, derived date, or automatic sweep.

**Closing a matter now surfaces the physical originals the firm still holds against it — and never
blocks.** This is the deliberate opposite of the trust close rule: money left in a client ledger
refuses a close outright, but a firm holds a client's will for decades after the last matter for that
client closed, and that is the steady state of a safe-custody register rather than a loose end. The
close response carries the notice; there is no arm of the contract on which it becomes a refusal, and
the notice reports a count and nothing that names the property, its owner, or its number.

**The will-deposit duty catalog ships with Nevada encoded, and refuses every jurisdiction that is
not.** Asking for a jurisdiction with no verified entry raises a named refusal rather than falling
back to a baseline, resolving to the most common answer, or returning an empty list somebody would
read as "nothing applies" — and "nobody recorded a jurisdiction" stays a different refusal from
"nobody has verified that jurisdiction", because they are fixed differently. Nevada carries **NRS
136.050(1)**'s 30-day delivery duty with the statute quoted verbatim and cited, the clock starting at
_knowledge_ of the death rather than the death, both delivery targets the statute offers, the civil
liability under subsection 3, and the consequence that delivering to the clerk makes the will a public
record. The named personal representative's own duty and the court-ordered production under NRS
136.060 sit beside it — the latter carrying no interval at all, because the statute says the court
names the time. The verified **absence** of any lifetime court deposit in Nevada is encoded as an
explicit negative, because uniform-act deposit language that Nevada never enacted circulates as though
it were Nevada law. The original-will lodging requirement is a **local court rule**, so it is keyed
below the state — Clark County and Washoe County only — and Nevada's other nine judicial districts
refuse on their own terms, since a local rule nobody checked is not the same as one that does not
exist.

The catalog carries what the statute says and never an interpretation of it: the open questions the
research left open — whether "knowledge of the death" reaches constructive knowledge, what answers the
"reasonable cause" defence — stay open, and a due date is computed only from a date a person recorded.
The register records no date of death today, so that computation ships as a seam rather than as a
number nobody supplied.

Also: the location tree's depth cap of eight is proven at both sides of the boundary and on both write
paths, and the ownership label on an owner link is validated against the firm's **own** catalog when
the firm has configured one (and against nothing when it has not) — never against a platform list of
tenancy forms.

Six routes over the existing `custody:read` and `custody:manage` permissions (no new permission), five
columns and nine triggers on the existing destruction-request table, and four problem types:
`custody-approver-must-differ`, `custody-intrinsic-value-not-destructible`,
`custody-destruction-not-actionable`, and `custody-jurisdiction-unavailable`.
