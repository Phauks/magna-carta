# Conflicts reports: what a check tells you, and what it does not

_The conflicts search, its record, and the per-matter report behind them are built, along with the API
that serves them. The screens — the matter's conflicts panel and the reviewer's queue — are authored
when those surfaces ship. Automatic re-checks when your directory changes, and the printable conflicts
report you could hand to a court, are not built yet._

## What it does

A conflicts check searches everything your firm has recorded — the people and organizations in your
directory, the relationships between them, and your own members — for anyone connected to the matter
in front of you. It then writes down what it searched, how, and what it turned up. That written record
is permanent: nothing in it is ever edited or deleted, and a later check adds to it rather than
replacing it.

The most important thing to understand about it is in the next section, and it is not a technicality.

## What Magna Carta will never tell you

**Magna Carta does not tell you a matter is safe to accept.** It will never show you a tick, a green
badge, a score, or a single word summarizing where a matter stands. That is not a missing feature and
it will not arrive later.

The reason is the nature of the search. A search can only look at what has been recorded. Your
directory holds what your firm has typed in; some things a conflicts search would ideally examine —
the text inside your documents, the client list a lateral hire brought with them — have nothing behind
them yet, and the report says so by name every time. A search that found nothing has established that
**this search found nothing**. It has not established that there is nothing to find.

So the platform reports, and you conclude. A report that says "we searched the party register at the
widest setting, followed 43 related people and companies, could not search document text because there
is no index of it, and nothing surfaced" is a description of a procedure — and if your firm is ever
asked to justify how it screened a matter, a described procedure is what the question is actually
about. A one-word verdict is not, and a one-word verdict the software produced is worse than none,
because it is a sentence a lawyer would then have to defend without having written it.

When a check turns up nothing, the report ends with the sentence **"Nothing surfaced."** That sentence
is about the search. It is not about the matter.

## Where a matter stands

Every matter has a conflicts position you can read at any time. It answers six questions and it
answers them separately, because collapsing them into one answer is exactly what loses the
information:

- **When was it last checked, and by whom?** The most recent check, with the settings it actually
  ran under — which sources, how strict the name matching was, how far it followed relationships.
  These are the settings on the day it ran, read back word for word, so a check from March still means
  in September what it meant in March.
- **Has your firm's policy moved since?** If you have since widened what a check must cover — added a
  source, raised the strictness, deepened the search — the position says so, and keeps saying so until
  a new check has actually run at the wider setting. Nothing is written to the old check; the
  comparison is made fresh every time you look, so it is never out of date.
- **What could not be searched, and why?** Every source that had nothing behind it, named, with the
  reason. A source that could not run is never reported as a source that ran and found nothing.
- **What has nobody answered?** How many of the check's results are still waiting for a person to look
  at them, grouped by how strong the evidence is. A result nobody has reviewed is shown as unanswered,
  not quietly aged out.
- **What has been answered, and by whom?** The results a reviewer has dealt with, grouped by what they
  decided, each naming the person who decided it.
- **Has it ever been checked at all?** A matter nobody has run a check on says exactly that, and it is
  a different answer from a matter that was checked and turned up nothing. Those two are never shown
  the same way.

## Deciding on a result

A conflicts check never decides anything. It surfaces candidates and orders them by how strong the
evidence is — an exact match on a tax or social security number is stronger evidence than two people
sharing a surname — and stops there. Nothing is hidden because it looked weak: a weak match you never
see is a missed conflict you never get the chance to catch.

A person decides. When you record a decision on a result you say what you concluded — that it is not
in fact a conflict, that a waiver is on file, that a screen has been put in place, or that the firm is
declining the work — and why, in your own words. Your name goes on it and stays on it.

Decisions are recorded, never overwritten. If you conclude one way and later change your mind, the
second decision is added and the first one stays visible underneath it. That is deliberate: what your
firm concluded at the time, and when it changed its mind, is precisely the history that matters if the
question is ever asked. See [signing in](signing-in.md) for who can record a decision at all — it is a
separate permission from running a check.

## Tips and edge cases

- **A check is a photograph.** It reflects your directory as it stood at that moment. Adding a party
  to the matter, or recording a company's parent months later, does not update a check that already
  ran. Run a new one — and until automatic re-checks arrive, do that yourself when the facts move.
- **Widening your firm's policy does not re-run anything.** It marks every earlier check as having run
  under the narrower setting, which is the honest answer, and leaves the decision about whether to
  re-check with you.
- **A name that turns up buried under many others is still a result.** Ordering by evidence strength
  is there to help you triage, not to filter. Everything found is shown.
- **Two parties on the same matter can surface against each other.** That is not a bug in the search:
  a company you are acting against turning out to be your client's parent is exactly the sort of thing
  worth seeing. It is marked so you can tell it apart from a clash with a different client.
- **Some kinds of identifier are never searched on their own.** A date of birth or the last four
  digits of a number match far too many people to be useful as a search on their own, so they are not
  used that way, and every report names them so you know they were left out.

## Related

- [Case calendar and deadlines](case-calendar-and-deadlines.md) — the matter timeline gathers the
  checks that have been run alongside everything else recorded about a case.
- [Signing in](signing-in.md) — permissions decide who may run a check and who may record a decision.
