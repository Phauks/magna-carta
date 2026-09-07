# Conflicts reports: what a check tells you, and what it does not

_The conflicts search, its record, the per-matter report behind them, and the screens that read and
configure them are all built. Automatic re-checks when your directory changes are built and have
their own guide: [automatic conflicts re-checks](automatic-conflicts-rechecks.md). One thing is not
built yet: the printable conflicts report you could hand to a court, which is why the print option
gives you the check as a printed sheet rather than a filed document._

## Where to find it

**Conflicts Check in the sidebar** is your firm's whole picture. Run a check from here against any
matter on your docket, and read the list of every check your firm has run — newest first, each one
saying what set it going, who asked for it if anybody did, and how many results it turned up. Open
any of them to read the check in full.

**The Conflicts tab on a matter**, next to Intake, is that one matter's record: when it was last
checked and under what settings, anything nobody has answered yet, whether your firm has since
widened what a check must cover, and a way to run another. It is also where the intake checklist
sends you, and it keeps working after the intake step is marked done — the record is most often
wanted long after the box is ticked.

A conflicts check also appears on the matter's activity history, and opens the check it refers to.

**Settings, Conflicts** is where your firm decides what every check must cover — see below.

## What your firm decides, and what it cannot switch off

Under **Settings, Conflicts** an owner or administrator sets your firm's floor: the minimum every
check searches, whoever runs it. Somebody running a check can search wider than the floor; a narrower
request is raised back up to it before it runs, and the check records that this happened. Nobody can
search below what your firm requires.

The floor covers what a check searches (the party register, the relationship graph, your own
members), which band it must reach, which of a person's names the narrower band compares — current,
former, maiden, alias, and two more your firm can add — how far it follows each kind of relationship,
and the two limits on how much one check may do.

Two things are shown but cannot be turned off, and the screen says why on each. **The party register**
is always searched, because conflicts apply across your whole firm. And the **current name** is always
compared, because a check that skipped the name someone goes by today would not be a conflicts check.

Three things worth knowing before you change it:

- **Changing the floor re-runs nothing.** No check already on your record is altered or repeated. What
  happens instead is that any matter whose last check no longer covers what you now require will say
  so on its own Conflicts tab, worked out fresh each time it is read.
- **Narrowing the floor reduces what your firm will look at from then on**, and no individual check
  records that somebody chose that. This is why the change is kept in your firm's audit trail and why
  only owners and administrators can make it.
- **What you save is what you are shown.** If you ask for something the platform cannot store as
  given — a limit above what one operation can carry, for instance — it is adjusted on save and the
  screen tells you exactly what was adjusted, rather than leaving you to notice a box that moved.

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
- **Did the search of related people and companies finish?** How far the check was allowed to follow
  relationships, and — if it hit the limit on how many connected records one check may look at — that
  it stopped early, and how many further records it knew about and did not search. A search that
  stopped early is never shown as one that finished.
- **What has nobody answered?** How many of the check's results are still waiting for a person to look
  at them, grouped by how strong the evidence is. A result nobody has reviewed is shown as unanswered,
  not quietly aged out.
- **What has been answered, and by whom?** The results a reviewer has dealt with, grouped by what they
  decided, each naming the person who decided it.
- **Has it ever been checked at all?** A matter nobody has run a check on says exactly that, and it is
  a different answer from a matter that was checked and turned up nothing. Those two are never shown
  the same way.

## How names are compared

Almost nobody's name is recorded the same way twice. A firm signs its letters `Smith & Jones LLP`,
a court caption writes `Smith and Jones, L.L.P.`, and an intake form writes `Smith and Jones`. A
surname that travelled between languages arrives spelled by whichever clerk wrote it down. So a check
compares names several ways at once, and every result tells you which comparison found it.

- **The same name spelled differently.** An ampersand written as the word `and`, a legal form written
  with dots or spelled out in full, a leading `The` — none of those change who the firm is, so a check
  reads through them. `Smith & Jones LLP` and `Smith and Jones, L.L.P.` are treated as the same name,
  and the result says so in those words.
- **The same name under a different legal form.** `Smith & Jones LLP` and `Smith & Jones LLC` are
  reported as a weaker kind of match, deliberately. They may be one firm that re-formed, or two
  unrelated legal persons that happen to share a name — and which one it is, is a question for you
  rather than for the software. The result raises it; it does not settle it.
- **Names that sound alike.** A name is also compared by how it sounds, which catches `Smith`/`Smyth`
  and `Cathrine`/`Catherine`. This comparison is tuned to English pronunciation, and there is a known
  gap in it: a surname that crossed languages before it reached your files — `Nowak` written as
  `Novak`, `Kowalczyk` as `Kovalchik` — is not reliably caught by it. A second comparison built for
  exactly that is designed and not yet built. Until it is, search the other spelling yourself if a
  name in front of you is one that travels.
- **Names a person used to have.** Former names, maiden names and recorded aliases are searched at the
  default setting, not only at the widest one. This is worth knowing because it is the single most
  commonly missed conflict: someone married, changed surname, and the firm searched only the name they
  go by now. Your firm can narrow this if it wants to, and whichever names a check compared are written
  onto that check's record, so an older check tells you what it actually did rather than leaving you to
  guess.
- **Nicknames are not searched.** `Bob` and `Robert`, `Peggy` and `Margaret` are not related by sound
  and no method works them out; they need a curated list, and Magna Carta does not ship one. Rather
  than leave the gap unmentioned, every report names nicknames as something it could not search, in the
  same way it names document text. If that matters for a name in front of you, search the other form
  yourself.

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
  ran; a fresh one does. Magna Carta now notices those changes and re-runs the check itself — see
  [automatic conflicts re-checks](automatic-conflicts-rechecks.md) for what sets one off, what
  deliberately does not, and how a matter tells you a re-check is owed before one has run.
- **Widening your firm's policy does not re-run anything.** It marks every earlier check as having run
  under the narrower setting, which is the honest answer, and leaves the decision about whether to
  re-check with you.
- **A name that turns up buried under many others is still a result.** Ordering by evidence strength
  is there to help you triage, not to filter. Everything found is shown.
- **Two parties on the same matter can surface against each other.** That is not a bug in the search:
  a company you are acting against turning out to be your client's parent is exactly the sort of thing
  worth seeing. It is marked so you can tell it apart from a clash with a different client.
- **Following relationships has a limit, and the report tells you when it was hit.** A check follows
  the relationships you have recorded — a company's parent, a person's spouse, who sits on which
  board — outwards from the parties on the matter. How far it goes is your firm's setting, and it is
  set separately for each kind of relationship, because "follow a company's renames and mergers as far
  as they go" and "do not walk from a spouse to her employer's other directors" are different
  instructions. There is also a limit on how many connected records one check may look at in total,
  because a large corporate group can run to thousands. If a check reaches that limit it stops, says
  so plainly, and tells you how many further records it knew were connected and did not search. That
  sentence is the point of the limit: an incomplete search you know about is workable, and one you do
  not know about is the failure this whole feature exists to prevent.
- **There is a second limit, on how many results one check may record, and it works the same way.**
  Following relationships and finding matches are two different costs. A check that follows a hundred
  connected records asks about each of them across your whole directory, so the number of results it
  can produce grows with the size of your directory rather than with the size of the corporate group.
  Your firm sets a limit on that too. If a check goes past it, the report says the results were cut
  short, how many it found, how many it recorded, and — the line to read first — how many of the ones
  it left out were strong evidence rather than a loose name resemblance. Strong evidence is kept:
  where something has to be left out, it is the weakest first, and a match between two parties on the
  matter you are checking is never left out at all. If you see a check reporting this, it is worth
  raising: it usually means the search is casting far wider than it needs to for your directory.
- **Relationships that have ended are still followed.** A divorced spouse, a subsidiary sold last
  year, a directorship someone resigned — the check follows all of them, and marks on the result that
  the connection had already ended. That is deliberate: the rules that most often decide a conflict
  are about former clients and former relationships, so a search that stopped at what is current today
  would miss exactly the cases that matter. Whether an ended connection still matters is your
  judgement, and the report gives you what you need to make it.
- **A record with hundreds of connections is never skipped for being busy.** A bank, a registered
  agent, or a state filing office can sit on hundreds of unrelated relationships, and it would be easy
  to make searches faster by stepping around them. Magna Carta does not, because a bank that appears
  on five hundred of your matters is exactly where a positional conflict lives. The limit is on how
  many records one check looks at in total, which the report can tell you about — never on which
  records it is willing to look at, which it could not.
- **Some kinds of identifier are never searched on their own.** A date of birth or the last four
  digits of a number match far too many people to be useful as a search on their own, so they are not
  used that way, and every report names them so you know they were left out.

## Related

- [Automatic conflicts re-checks](automatic-conflicts-rechecks.md) — what makes a matter get looked at
  again on its own, and how a matter says a re-check is owed before one has run.
- [Case calendar and deadlines](case-calendar-and-deadlines.md) — the matter timeline gathers the
  checks that have been run alongside everything else recorded about a case.
- [Signing in](signing-in.md) — permissions decide who may run a check and who may record a decision.
