# Coding documents in review — deciding, and being able to show it

_The coding model, the history behind it, and who may see a review set are built, along with the API.
The screens — the coding panel a reviewer works through, the tag chips on the document list, and the
document viewer beside them — are authored when those surfaces ship._

## What it does

Lets a reviewer say what each document in a review set is — responsive or not, privileged or not,
confidential, whatever else the case needs — and keeps a record of every one of those decisions that
you can still stand behind two years later.

The deciding part is the easy half. The half that matters is the record. When a production is
challenged, the questions are not "is this document responsive" — they are "who decided that, when,
were they looking at one document or twenty thousand at once, what did they search to get that
twenty thousand, and did anyone change it afterwards". Every one of those is answered here from a
record, not from memory.

## The coding panel

Each review set has its own set of questions, and each question has its own answers. Every set starts
with three:

- **Responsiveness** — Responsive, Non-responsive, Needs further review.
- **Privilege** — Privileged, Privileged (redact), Not privileged.
- **Confidentiality** — Confidential, Highly confidential (attorneys' eyes only), Not confidential.

You can rename any of these to whatever your case calls them, and you can add your own questions
beside them — issue codes, custodian themes, anything you sort by.

A question is one of two shapes, and choosing the right one is the only decision that really matters:

- **Pick one.** A document is responsive _or_ non-responsive, never both. Answering again replaces
  the previous answer.
- **Pick any.** A document can carry several issue codes at once.

Use "pick one" for anything where two answers would contradict each other. The system holds you to
it — a document physically cannot end up coded both responsive and non-responsive, even if two people
code it at the same moment. That is worth having, because a set where four percent of documents are
both is a set you cannot produce from until somebody cleans it up.

## Coding a document

Open a document and answer the questions. Three things happen that are worth knowing about:

**Changing an answer keeps the old one.** Nothing is erased. Re-coding a document from Responsive to
Non-responsive records that the first answer was made, by whom, when, and that it was replaced. The
history of one document is one list.

**"Apply to family" means every document in the family.** An email and its attachments are a family.
Coding the family writes the decision onto each member separately rather than onto the email with a
rule that the attachments follow. That sounds like a technicality; it is the single most important
one on this page. A rule that gets worked out later is a rule that can be worked out wrongly later —
and the moment it is worked out is the moment you produce, which is the worst possible moment to
discover an attachment was privileged.

**Deactivating a tag never removes it from documents.** If your case stops using an issue code, take
it out of use — it disappears from the panel and stays on every document anyone ever applied it to.
The answers the system itself relies on (the privilege and responsiveness ones) cannot be taken out
of use at all; rename them instead, which is always safe.

## Coding in bulk, and taking it back

You can apply or remove a tag across a set of documents at once. Before anything is written, the
system fixes the list of documents the operation will touch and works from that fixed list. You get
told how many it acted on.

That fixed list is the point. A bulk operation that re-ran your filter as it went would tag documents
that arrived, or changed, while it was running — documents you never saw and never approved. The
filter you used is recorded alongside for whoever reads the history later, but it is never re-run.

**Undo is exact.** Undoing a bulk operation takes back precisely what that operation did, and nothing
else:

- A tag somebody applied independently afterwards stays.
- A document somebody has since re-coded stays as they re-coded it.
- A document whose tag was already removed keeps whoever removed it.

Nothing is deleted by undoing. The operation stays in the history, marked as reversed, pointing at
the reversal. An undo is itself a recorded act, so you cannot undo an undo — apply or remove the tag
again instead, which is a new decision and should read like one.

## Knowing where the review has got to

The progress view answers four questions:

- How many documents have been answered on every question that requires one.
- How many documents carry each tag.
- Which documents are still uncoded.
- **Which families are split across the produce/withhold line** — a family where something is coded
  responsive and something else is coded privileged.

That last one deserves a moment. A privileged attachment hanging off a responsive parent email is
exactly the shape that gets produced by accident. The list is worked out fresh every time you look at
it, from the coding as it stands right now, so re-coding either document changes the answer
immediately. It is a list to work through before you produce, not a warning that appears once.

## Who can see a review set

**Access to a case does not give access to its review sets.** Each set has its own list of people,
and being on that list is separate from being on the matter, having the discovery permission, or
anything else.

This exists because it has to. Material another party produces may be restricted to attorneys by
court order, and "attorneys' eyes only" is, in practice, a review set whose list is two people.

Three consequences to expect:

- **A set you are not on is invisible, not locked.** It does not appear in lists or counts, and
  looking for it directly says the same thing it would say about a set that does not exist. That is
  deliberate: telling you a set exists but you may not see it already tells you something.
- **A new set starts with just the person who created it.** Add whoever else should be on it. That is
  a small chore on purpose — the alternative is the system guessing who is cleared, and guessing
  wrong there is the mistake that matters.
- **The last person cannot be removed.** A set nobody is on is a set nobody can reach or repair.

Managing the list needs the same permission as producing documents, because widening who can see a
case's material is the same kind of decision as deciding what leaves the firm.

## Tips and edge cases

- **Rename freely.** Nothing in the system matches your tags by their names, so calling Privileged
  "Withhold — AC privilege" changes the wording everywhere and changes nothing else.
- **Tags you create do not drive anything.** They filter, group, and export. The answers that decide
  what a production withholds are the built-in ones, so that renaming a label can never quietly
  change what leaves the firm.
- **"Requires an answer" changes what your progress figure means.** Turn it on only for questions you
  expect every document to answer. Turning it on for a question most documents will skip makes the
  uncoded count something you learn to ignore, which is worse than not having it.
- **Duplicates are coded once.** You code the copy the set treats as the original; the other copies
  read through to it. Nothing to keep in step, because nothing was copied.
- **A big bulk operation is several writes, not one.** If one is interrupted, the history shows it as
  still running with exactly the documents it did reach recorded against it — and undoing it takes
  back exactly those. You will not find a bulk operation that half-happened and left no trace.

## Related features

- [Review sets and loading](review-sets-and-loading.md) — building the set you are coding, and whose
  records each document was.
- [Filing email to a matter](filing-email-to-a-matter.md) — how the email in a review set got onto
  the matter.
