# Automatic conflicts re-checks: what makes a matter get looked at again

_The re-checks themselves, the record of what is owed, and the notification are built. The screen that
shows a matter's pending re-checks is authored when the conflicts panel ships; today the information
is available through the API and in the notification you receive._

## What it does

A conflicts check is a photograph of two things that both move: the parties on the matter, and
everything your firm has recorded about the people and organizations it deals with. A check that was
honest on the day it ran can be wrong a month later without anybody doing anything careless.

Magna Carta now watches for the changes that could make that happen, and re-runs the check itself.

## What sets a re-check off

Six kinds of change, and only these:

- **A party is added to a matter.** The commonest one. A matter screened at the start with two names
  gains a third in month four.
- **Two records are merged into one.** Two entries for the same company were each unremarkable on
  their own; combined, the single record they become carries both sets of names, both sets of
  identifiers, and both sets of relationships — and that combination may not be unremarkable at all.
  Every matter that named **either** record is re-checked, including a matter that only ever knew the
  one that was archived.
- **A name is added or changed.** A former name, a maiden name, a trading name. A name the search did
  not know about could not have been matched against.
- **A relationship is recorded.** A parent company, a spouse, a director. Discovering the link later
  changes how far a search reaches from the matter's own parties.
- **A tax or social security number is entered.** These are the strongest evidence a search can find,
  and one entered after a check ran could not have been matched then.
- **Somebody joins the firm.** Your professional obligations are imputed across the whole firm, so a
  new colleague can change the answer on a matter whose parties never moved at all.

Beyond those, a **scheduled re-screen** sweeps your open matters on a cadence — weekly unless you
change it — whether or not anything announced itself. That exists because the list above is a list,
and any list can turn out to be incomplete.

## What deliberately does not set one off

- **Adding a new person or organization to your directory on its own.** A new record cannot change any
  existing matter's answer until something links it to a matter or connects it to something. Without
  this rule, importing two thousand contacts would re-screen your entire caseload for no possible new
  result.
- **Removing a party from a matter.** Taking a name off cannot create a conflict, and the earlier
  check's results stay on the record exactly as found — what your firm knew at the time is the point.
- **Recording a decision on a result.** Deciding comes after a check; it never causes one.
- **Closing a matter.** A closed matter's parties remain findable by other matters' checks. The closed
  matter itself is not re-screened, and its position goes on reporting its last check word for word.
- **Widening your firm's policy.** That does not re-run anything, deliberately: it would put every
  open matter through a fresh search on a single administrative click. Instead every affected matter
  immediately reports that its last check ran under the narrower setting, which is the honest answer.

## What you see

**A matter says a re-check is owed from the moment the change is recorded** — not from whenever the
re-check gets round to running. A matter's conflicts position lists each one, naming what changed and
when it happened, and the entry disappears only when a check has actually covered it.

That matters more than the speed does. If your firm's re-screening ever falls behind, the matters
waiting say so out loud rather than looking up to date. A backlog you can see is a different thing
from a stale answer that looks fresh.

**Several changes become one check, and the check names all of them.** If three things happen to a
matter before the re-check runs, you get one search covering all three, listed on the record — not
three searches, and never two of the three quietly dropped.

**An automated check is not credited to anybody.** It records that it ran automatically and what set
it off. Nobody's name goes on a search they did not ask for.

## Being told

You are notified when an **automatic** check turns something up — either a result at one of the two
strongest evidence levels, or the first result ever on a matter that had none. A check you ran
yourself does not notify you: you are looking at the result.

The notification tells you how many results surfaced and how many are strong, and takes you to the
matter. It deliberately carries **no names** — not the person or company that surfaced, not what
matched. A notification sits in a feed and in an inbox long after it was sent, and a name that turned
up in a conflicts search is among the most sensitive things your firm holds. The detail is behind the
link, where your permission to see it is checked at the moment you look.

## Settings

Your firm controls:

- **Whether the scheduled re-screen runs at all, and how often.** Weekly by default. If you switch it
  off, that fact is recorded and reported alongside the matter's position — a backstop that is off and
  invisible would be worse than none.
- **How many matters one change re-checks at once.** A change affecting hundreds of matters always
  records that every one of them is owed a re-check; this setting only governs how many are attempted
  immediately, with the rest worked through oldest-first.

## Tips and edge cases

- **Nothing is ever decided for you.** An automatic re-check runs a search and records what it found.
  It cannot mark a result as reviewed, cleared, or waived — that remains a person's act with that
  person's name on it, and the software is built so that it cannot do otherwise.
- **A re-check that finds the same thing again is not hidden.** Everything found is recorded. Grouping
  results you have already concluded on so you are not asked twice is coming with the reviewer's
  queue.
- **The re-check searches your firm's policy settings, not the earlier check's.** If you widened what
  a check must cover, the automatic re-check runs at the wider setting.
- **Nothing you do waits on it.** All of this runs in the background; no page you use gets slower
  because a merge kicked off forty re-checks.

## Related

- [Conflicts reports](conflicts-reports.md) — what a check tells you, what it will never tell you, and
  where a matter stands.
- [Signing in](signing-in.md) — who is told about a result, and who may record a decision on one.
