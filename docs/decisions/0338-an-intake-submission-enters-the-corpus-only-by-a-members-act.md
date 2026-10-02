---
number: 338
slug: an-intake-submission-enters-the-corpus-only-by-a-members-act
status: Proposed
date: 2026-08-15
area: Client intake
summary: "An inbound enquiry lands as an `intake_submission` — a record that is not a Directory entity, not a matter, and not in the conflicts corpus — and only a named member's audited act turns one into an entity plus a prospective matter. The boundary is drawn at triage rather than at conversion because the Directory is effectively permanent: it soft-deletes only, and a merged subordinate deliberately stays in the corpus so a merged-away alias still surfaces a hit. Anything an anonymous stranger can write into the Directory is in the conflicts corpus forever, and a corpus full of bot submissions is a corpus a reviewer stops reading. Nothing automated promotes a submission — no queue consumer, no cron, no rule engine — and a submission may not carry a protected identifier at all, enforced by the form field vocabulary having no kind that maps to a protected field declaration rather than by validation."
---

**The front door does not open onto the Directory: an enquiry is a submission until a member accepts
it, and only a member's act writes a person into the permanent corpus.**

**Context:** intake has to accept input from people the firm has never met — a public form, a call, a
walk-in — and the natural implementation creates the Directory entity on arrival, because that is
what makes the enquiry checkable. That implementation is unsafe for a reason specific to this
Directory: it soft-deletes only, and a merged subordinate keeps `status = 'merged_into'` and stays in
the corpus **on purpose**, so a merged-away alias still surfaces a hit. That is correct for a
conflicts corpus, and it means there is no undo. Whatever an anonymous stranger can put into the
Directory is in the conflicts corpus permanently.

**Decision:** a new `intake_submission` record holds one inbound approach that no member has yet
accepted — the verbatim payload, typed columns for the bounded field vocabulary a form may ask for, a
`source` from an open catalog, the form version it arrived through, the receipt instant, and a triage
outcome. It is not a Directory entity and not a matter. Four rules bind it:

A submission is **never in the conflicts corpus** — no phonetic code, no trigram row, no blind index,
invisible to `findDuplicateCandidates` and to the party matcher. A submission surfacing as a
conflicts hit would be the platform asserting a relationship between the firm and somebody who filled
in a web form.

**Nothing automated promotes one.** No queue consumer, no scheduled handler, no rule engine turns a
submission into an entity. The act is a member's, it is audited, and the audit row names them,
because the first thing that ever writes a person into a permanent corpus should be a person.

**A submission may not carry a protected identifier** — no social security or employer identification
number, no driver's licence, no date of birth, no account number. The protected-field machinery
exists so that a named member holding the decrypt permission takes responsibility for sealed personal
data; collecting it from an anonymous stranger puts it in the firm's custody with nobody having
accepted it. The enforcement is structural: the form field vocabulary has no kind that maps to a
protected-field declaration, so there is no shape a form can be given that would collect one.

**A rejected submission is not a soft-deleted prospect**, because it never became one. Rejection is
recorded and the payload stays; purging is a separate retention question, and a hard one, since an
untriaged enquiry from a genuine prospective client and a bot post look identical to a purge job.

**Considered and rejected:** creating the entity on arrival and soft-deleting the bad ones (there is
no undo in a corpus that keeps merged-away records on purpose); a quarantined Directory partition for
unpromoted entities (a second corpus the engine would either have to read, defeating the point, or
not read, making the partition a lie); automated promotion above a spam score (a score is a
verdict-shaped number one step away from a gate, and the failure is silent).

**Consequences:** the conflicts corpus stays a record of people the firm actually dealt with, and no
volume of spam can change that. The cost is a triage queue that a firm must work, and a second
vocabulary — the form's fields are not custom-field definitions — whose mapping is a triage-time
concern.
