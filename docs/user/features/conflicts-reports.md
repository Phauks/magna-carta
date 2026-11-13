# Conflicts reports: what a check tells you, and what it does not

_The conflicts search, its record, the per-matter report behind them, and the screens that read and
configure them are all built. Automatic re-checks when your directory changes are built and have
their own guide: [automatic conflicts re-checks](automatic-conflicts-rechecks.md). The report you
hand to a court is the check's printed sheet, which you can print or download as a PDF from the
check's own screen; it is not yet a document filed on the matter._

## Where to find it

**Every check has a number** — CC2026-00001, CC2026-00002, and so on, restarting each year unless
your firm shapes it otherwise under **Settings › Practice › Numbering** — drawn the moment it is
opened. It is how a check is referred to: on its own screen, in the log, and on anything you print. A check is run
as often as you need; every run belongs to the same number, and the check's screen lists them all.

**Conflicts Check in the sidebar** is your firm's whole picture: the log of every check your firm has
opened, across every matter, newest first. Each row leads with the check's number and says when it
was opened, when it last ran, how many times it has run and where the latest run is, what set that
run going, who asked for it if anybody did, whether the check is filed on a matter or stands over
named parties with no matter yet, how widely it matched names, whether your firm's floor widened it,
and how many candidates it turned up. Open a row to read that check in full. Narrow the log from any
column's own heading — by trigger, by who asked, by run state — and clear the narrowing from the
control beside New Check.

**New Check**, at the top right of that screen, opens the panel, which has two sides, and shows the
number the check will get. The left side asks for one thing: the **Parties** to search for. The panel
does not ask for a matter; you file a check on a matter from its report once you know which one. The
right side has two tabs: **Locations**, the places the check searches, and **Advanced Settings**, how
names are compared. You can leave every one of them alone. Pressing **Run Check** opens the check and
takes you to its screen, where the search runs in front of you.

**The check's screen** is titled by its number, with two tabs: **Report** and **History**.

- **Report** has three sections, each of which you can fold away. **Details** is what was asked for:
  the parties, one per line, then the settings (what each location searched, how names were
  compared, who asked, and the matter it is filed on, or No Matter).
  **Status** has a row for each location with what it is doing while the run is under way, and what
  it did once it finishes; open a row to read its log. Once the run finishes, the Directory row opens
  onto blocks, one per row: when and by whom it searched, names and identifiers, relationships, Firm
  Employees, what was not searched and why (tinted, so a gap stands out), and the results. The
  printed report has the same parts. A location that cannot be searched yet reads Not searched. **Results** is what the search turned up (see below).
- **History** lists every run of the check with when it started, how long it took, who asked, how
  many results it found and how it ended. Click a run's name to show its report on the Report tab. **Run Again** searches again
  with the same parties and settings, as a further run under the same number.

While a run is under way, the badge at the top reads **Running** with the time so far, and pressing
its **Cancel** half stops the run. A cancelled run stays in the check's history as Cancelled, naming
who stopped it, and records no results. The two icon buttons beside the badge print the report and
download it as a PDF, kept in your Downloads; hover over either to see which is which. On a check
with no matter, **Assign to Matter** beside them files it on one: pick the matter (the parties'
own matters are listed first) and press **Assign**. The next run searches with that matter's
parties too.

**The Conflicts tab on a matter**, next to Intake, is that one matter's record: when it was last
checked and under what settings, anything nobody has answered yet, and whether your firm has since
widened what a check must cover. **New Check** at the top of the matter opens the same form with the
matter already filled in, and **Re-check now** beside the standing runs your firm's floor without
asking you anything. It is also where the intake checklist sends you, and it keeps working after the
intake step is marked done — the record is most often wanted long after the box is ticked.

A conflicts check also appears on the matter's activity history, and opens the check it refers to.

**Settings, Conflicts** is where your firm decides what every check must cover — see below.

## The search settings, and what each one searches

The right side of the New Check panel is the search itself, in two tabs.

**Locations** is where the check looks: five places, each opening onto what it searches.

- **Directory**: every party your firm has ever recorded. **Names and identifiers** is always on.
  **Relationships** walks outwards from each party you named, through every relationship your
  directory holds, as far as each chain goes. **Firm Employees** looks for your own people by
  identity, never by name: on a check filed on a matter, among that matter's parties, and on any check,
  among everyone the search reached.
- **Messaging** (Calls, Texts, Email): your firm's call and text log and its captured email, whether
  or not a message has been filed on a matter. A call or text is found when it is linked to the
  party's directory record, when its number is one of the party's phone numbers, or when the party's
  name appears in the caller ID, the message or the summary. An email is found when a sender or
  recipient is the party, by record, by address or by name, or when the party's name is in the
  subject. **An email's body is not searched.**
- **Tasks** (Consultations, Open, Closed, Archived): tasks whose title or description names the party.
  The first three choose tasks by the status of their matter; **Archived** adds archived tasks from
  any matter. A task on no matter is searched whenever Tasks is on.
- **Magnus** (All Employee Conversations): every conversation with Magnus that has not been deleted,
  including those saved to General, searched for the party's name.
- **Files** (Consultations, Open, Closed, Archived): the text of documents filed on a matter, searched
  for each of the party's names as an exact phrase. The first three choose files by the status of
  their matter; **Archived** adds files deleted from any matter, which your firm still keeps. The most
  recently active matters are searched first, and if a check reaches its limit the report says how
  many matters' files were left unsearched. Files are read through the file search index. Until an
  Owner or Administrator turns file indexing on (**Settings › Data & Platform › Search and Indexing**),
  Files reads **Not searched** on every check that asks for it, with the reason, so a report never
  reads as if your documents were searched and came up empty. Once it is on, a check reads the files
  the index holds at that moment. A file that has not been indexed yet, or that could not be read, is
  not searched; the same settings page shows how many of your files are indexed and how many are not.

Every option is on when the panel opens. In messages, tasks and conversations a party's name is
looked for **as whole words, in order, without regard to case or accents**: Acme Holdings LLC is
looked for as "Acme Holdings LLC", never as "Acme" alone; José Ortega also finds "Jose Ortega"; and
a name shorter than three characters is not looked for in text at all. A name is not found inside a
longer word. If one name turns up in more than 200 records of one place, the first 200 are kept and
the report says so. The report says this in its Status section, under each place.

A result found in a message, task, conversation or file says what kind of record it was found in
(Call, Text, Email, Task, Magnus conversation, File), the matter it is filed on, and when it happened, with a link
to the matter. It never quotes the record's text: open the record from the matter to read it.

**Advanced Settings** holds **name matching**, which decides how many ways a name may be written and
still count. It is a dropdown, and each choice shows a name it would catch. **Both choices match
names that sound alike** — Stephen and Steven, Smith and Smyth.

- **Standard** compares the name rows your firm has chosen — current, former, maiden and alias out of
  the box — under the main sound-alike encoder. Stephen finds Steven; a maiden name finds the married
  one.
- **Widest** compares every name your directory holds, trading styles and also-known-as names
  included, under every encoder. It is a strict superset of Standard: widening can only add
  candidates, never hide one.

Below it, **Trigram matching** also finds a name because it shares a three-letter piece with a
party's name, which catches a misspelling such as "Jonhson" for "Johnson". It is the noisiest way a
name is found, and a result found only this way is the weakest kind. It is on unless you clear it,
and you can clear it only under Standard: Widest always uses it. A check run without it says so in
its Details and in its report.

**There is no limit to set.** A check follows every relationship your directory holds, as far as
the chain goes, and there is no cap on how much it may look at or record. The platform keeps one
ceiling of its own on a single search, far above any real corporate group; a run that reaches it
says so on its own record and says how much it did not reach, so a search that stopped short is
never shown as one that finished.

**You are not asked whether the check is preliminary or comprehensive.** Those two words say _when_ a
check ran, not how it searched: the screen before your firm takes a matter on, or the moment it
accepts. A check filed against a matter your firm has already taken on is comprehensive, and every
other check is preliminary. The check's screen says which one it went into the log as.

## What your firm decides, and what it cannot switch off

Under **Settings, Conflicts** an owner or administrator sets your firm's floor: the minimum every
check searches, whoever runs it. Somebody running a check can search wider than the floor; a narrower
request is raised back up to it before it runs, and the check records that this happened. Nobody can
search below what your firm requires.

The floor covers what a check searches (names and identifiers, relationships, your own people), how
widely it must match names, and which of a person's names standard matching compares — current,
former, maiden, alias, and two more your firm can add. How far a check follows relationships is not a
setting: every check follows every recorded relationship to the end of the chain.

Two things are shown but cannot be turned off, and the screen says why on each. **Names and
identifiers** are always searched, because conflicts apply across your whole firm. And the **current name** is always
compared, because a check that skipped the name someone goes by today would not be a conflicts check.

Three things worth knowing before you change it:

- **Changing the floor re-runs nothing.** No check already on your record is altered or repeated. What
  happens instead is that any matter whose last check no longer covers what you now require will say
  so on its own Conflicts tab, worked out fresh each time it is read.
- **Narrowing the floor reduces what your firm will look at from then on**, and no individual check
  records that somebody chose that. This is why the change is kept in your firm's audit trail and why
  only owners and administrators can make it.
- **What you save is what you are shown.** If you ask for something the platform cannot store as
  given — a floor without the names-and-identifiers search, for instance — it is repaired on save and
  the screen tells you exactly what was repaired, rather than leaving you to notice a box that moved.

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

When a check turns up nothing, the report ends with the sentence **"0 results."** That sentence
is about the search. It is not about the matter.

## Where a matter stands

Every matter has a conflicts position you can read at any time. It answers six questions and it
answers them separately, because collapsing them into one answer is exactly what loses the
information:

- **When was it last checked, and by whom?** The most recent check, by number, with the settings it
  actually ran under — where it looked, how widely it matched names, how far the longest chain of
  relationships ran. These are the settings on the day it ran, read back word for word, so a check
  from March still means in September what it meant in March.
- **Has your firm's policy moved since?** If you have since widened what a check must cover — added a
  source, widened the name matching — the position says so, and keeps saying so until a new check
  has actually run at the wider setting. Nothing is written to the old check; the comparison is made
  fresh every time you look, so it is never out of date.
- **What could not be searched, and why?** Every source that had nothing behind it, named, with the
  reason. A source that could not run is never reported as a source that ran and found nothing.
- **Did the search of related people and companies finish?** Every relationship is followed to the
  end of its chain; if a run reached the platform's own ceiling on one search, the position says it
  stopped early and how many further records it knew about and did not search. A search that stopped
  early is never shown as one that finished.
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

A conflicts check never decides anything. It surfaces results and orders them by how strong the
evidence is — an exact match on a tax or social security number is stronger evidence than two people
sharing a surname — and stops there. Nothing is hidden because it looked weak: a weak match you never
see is a missed conflict you never get the chance to catch.

Each result in **Results** is a card. It shows the name, how strong the match is in a word (**Exact**,
**Same name**, **Might be**, **Weak**), which search found it, what matched, and how it was reached:
directly, as another party on the same check, as one of your own people, or through a chain of
relationships. The arrow at the left opens the full account in place, and clicking the name opens the
result's own window with its history of decisions. Above the cards you can narrow the list by text,
by which search found it, by strength and by review state; each chip shows how many results it would
keep.

A person decides. Each card's review menu reads **Not reviewed** until somebody decides; choose
**Cleared** (it is not in fact a conflict), **Waived** (a waiver is on file), **Walled off** (a screen
has been put in place) or **Declined** (the firm is declining the work), and say why in your own
words. Your name goes on it and stays on it.

Decisions are recorded, never overwritten. If you conclude one way and later change your mind, the
second decision is added and the first one stays visible underneath it. That is deliberate: what your
firm concluded at the time, and when it changed its mind, is precisely the history that matters if the
question is ever asked. See [signing in](signing-in.md) for who can record a decision at all — it is a
separate permission from running a check.

## Tips and edge cases

- **A run is a photograph.** It reflects your directory as it stood at that moment. Adding a party
  to the matter, or recording a company's parent months later, does not update a run that already
  finished; **Run Again** on the check does, as a further run under the same number, and both stay
  on the check. Magna Carta now notices those changes and re-runs the check itself — see
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
- **Relationships are followed all the way, and the report tells you if a search was cut short.** A
  check follows the relationships you have recorded — a company's parent, a person's spouse, who sits
  on which board — outwards from the parties on the matter, as far as every chain goes. Nobody sets a
  limit. The platform keeps one ceiling of its own on how many connected records a single search may
  reach, far above any real corporate group; if a run reaches it, the run stops, says so plainly, and
  tells you how many further records it knew were connected and did not search. That sentence is the
  point: an incomplete search you know about is workable, and one you do not know about is the
  failure this whole feature exists to prevent.
- **There is one bound on how many results one run can record, and it works the same way.** It is
  the most one record can carry, not a setting. If a run surfaces more than that, the report says the
  results were cut short, how many it found, how many it recorded, and — the line to read first — how
  many of the ones it left out were strong evidence rather than a loose name resemblance. Strong
  evidence is kept: where something has to be left out, it is the weakest first, and a match between
  two parties on the matter you are checking is never left out at all. If you see a check reporting
  this, it is worth raising.
- **Relationships that have ended are still followed.** A divorced spouse, a subsidiary sold last
  year, a directorship someone resigned — the check follows all of them, and marks on the result that
  the connection had already ended. That is deliberate: the rules that most often decide a conflict
  are about former clients and former relationships, so a search that stopped at what is current today
  would miss exactly the cases that matter. Whether an ended connection still matters is your
  judgement, and the report gives you what you need to make it.
- **A record with hundreds of connections is never skipped for being busy.** A bank, a registered
  agent, or a state filing office can sit on hundreds of unrelated relationships, and it would be easy
  to make searches faster by stepping around them. Magna Carta does not, because a bank that appears
  on five hundred of your matters is exactly where a positional conflict lives. The one ceiling is on
  how many records a single search reaches in total, which the report can tell you about — never on
  which records it is willing to look at, which it could not.
- **Some kinds of identifier are never searched on their own.** A date of birth or the last four
  digits of a number match far too many people to be useful as a search on their own, so they are not
  used that way, and every report names them so you know they were left out.

## Related

- [Automatic conflicts re-checks](automatic-conflicts-rechecks.md) — what makes a matter get looked at
  again on its own, and how a matter says a re-check is owed before one has run.
- [Case calendar and deadlines](case-calendar-and-deadlines.md) — the matter timeline gathers the
  checks that have been run alongside everything else recorded about a case.
- [Signing in](signing-in.md) — permissions decide who may run a check and who may record a decision.
