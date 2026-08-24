# Product changelog

What changed in Magna Carta, written for the people who use it. Entries are dated rather than
versioned: the product ships continuously and no release has been cut, so a date is the honest unit.

This file is **assembled, never hand-edited on a branch.** Its entries come from the `## Public`
blocks of `audience: public` fragments in [`changelog.d/`](../changelog.d/), folded in on `main` by
`vp run changelog-build` — the same one pass that folds the developer half of those fragments into
[`CHANGELOG.md`](../CHANGELOG.md). Two audiences, two sets of sentences, one source and one review.

Curation happens here, in this file, at publish time: the folded entries are the raw material, and
a dated section may be edited on `main` into the thematic roll-up a reader actually wants rather
than one bullet per merge. What is never done here is authoring a change that has no fragment
behind it.

Categories: **Added · Changed · Deprecated · Removed · Fixed · Security.**

## 2026-08-24

### Added

- **Your firm can now set its own notification policy.** Three things that were fixed for everybody are
now yours to decide:

- **Which categories every member hears in app.** Turning a category on for the firm means nobody can
  switch it off for themselves — useful for the kinds of notice a practice needs its staff to see. It
  works one way only: your firm can insist a category reaches people, and cannot stop somebody hearing
  about their own work.
- **How long notifications are kept.** Anywhere from thirty days to a year. A shorter window is not a
  loss of the record — the matter timeline and the audit log keep their own — but it does decide how
  far back somebody returning from leave can scroll.
- **What time the daily and weekly summary emails go out**, in your own office's local hour rather
  than at a time the platform picked.

**Email stays the member's decision.** Your firm can set a default cadence, and can never raise
somebody's — a summary is a copy in a mailbox your firm may not administer, so the more private of the
two choices always wins.

**It is an administrator's setting, not a personal one.** Only Owner/Admin seats can read or change
it, and every change is recorded in your firm's audit log with what was changed and who changed it —
never anybody's name beyond the person who made the change.

The screens for this are still being built; what the settings mean is described in
[Notification emails](features/notification-emails.md).
- **Your firm's own fields now go on an asset.** The fixed kinds and your firm's own type list cover
what a thing **is**; a timeshare's week number, a boat's slip number, or who valued a piece of
jewellery is a fact **about** a thing, and until now there was nowhere to put one. It is the same
feature you already use on matters and on contacts — the same field types, the same administration
screen, the same rules.

Attach a field to one kind of thing and it appears there and nowhere else: "slip number" on vehicles
shows on the boat and not on the house. Attach it to nothing and it appears on every asset.

Everything that is already true of a firm-defined field is true here. Renaming one never loses what
was recorded in it, because a value is tied to the field itself rather than to what it is called.
Archiving one keeps every answer already recorded and stops it appearing on new records. Deleting one
outright is still refused once anything has been recorded in it.

Two limits worth knowing. **A firm-defined field is ordinary stored text, not a sealed one** — an
account or policy number has its own handling on the asset record, and a password, recovery phrase,
or safe combination has no home in the register at all. And **an asset field is not yet a merge
field**: a firm-defined field on a _matter_ can fill in a document, one on an asset cannot, because
an asset field would have to print once per asset inside a repeating block and that is a separate
piece of work.
- **A fillable PDF your firm already has — a court form, an agency form, your own intake sheet — can now
be registered as a template, and the same merge fields that fill a Word letter fill its boxes.**

Upload it as a fillable PDF instead of a Word document. Everything else about a template is the same:
the same catalogue, the same version history, the same record of which version produced which document,
and a filed PDF that lands in the matter's documents like any other file.

**Nothing is guessed about what a box means.** A Word template tells us what its blanks are because you
typed them; a form carries only the name whoever built it gave each box — `Petitioner_Name_1`,
`TextField12`, sometimes nothing recognisable. So registering a form lists every box on it — what kind
it is, which page, whether the form marks it required — and you say which merge field fills each one.
What you say is remembered for your firm, so the next form using the same box names arrives already
filled in. Where a box's name happens to be exactly a merge field's, that is offered, and still only
offered: a box called `ClientName` is not turned into the client's name because it looked close. That is
a decision about a client's details in a document you are about to file, and it belongs to you.

**Every box is accounted for, and the ones nothing fills in are named** — boxes with no merge field
chosen, buttons and signature boxes, and boxes the form declares without saying what type they are. Each
is listed with the reason at registration, in the field list, and again on every document you assemble,
which is marked as needing review. A form that binds nothing at all says so plainly rather than quietly
producing the blank form every time.

**Anything already typed into the form is removed when it is stored.** Firms upload the copy they last
filed, and a template still carrying the previous client's answers is the last thing anyone wants.

Missing values behave exactly as in a Word template: the same visible `[CLIENT ADDRESS]` marker inside
the box, the same report, and the same stop when a field is set to require an answer. A tick box and a
drop-down have nowhere to print a marker, so they are left unanswered and the report says which box and
why — ticking a box to mean "we do not know" answers the form's question wrongly, which is worse than
leaving it for a person.

A document built from a form keeps its boxes, so whoever receives it can still correct a typo or
complete what you left for them.
- **Automatic filing can now be set up, watched, and stopped.** An auto-file rule puts a message on the
right matter as it arrives rather than waiting for somebody to go and find the matter — most valuable
on your firm's general capture address, where mail lands today with no matter at all. You can create a
rule from a message you just filed, change whether it files outright or places the message for
someone to confirm, pause it, put it back, or retire it for good.

**Two new answers you can ask for.** "Why is this message here?" returns the reasons behind an
automatic filing in plain sentences, weeks later, without anybody reconstructing them. And a
thirty-day summary tells you, per rule, how many messages it filed, how many it placed for
confirmation, how many of those somebody has since removed, and whether it has stopped itself — which
is the report to read **before** deciding whether to allow filing without a confirming click, so that
decision rests on what your rules have actually been doing rather than on a guess.

**Setting up a rule is a separate permission from filing mail.** Your firm can grant somebody the
ability to file email to a matter without also granting them the ability to configure the machine to
file email. A rule can only ever name a matter its creator can open, and it stops itself if they lose
that access.

**Rules stay cautious in the ways they always were.** A rule that follows a conversation can only be
created once your firm has actually filed a message from that conversation to the matter. Nothing
already in your archive is ever touched — creating, resuming or re-pointing a rule applies only to mail
that arrives afterwards. And a rule asking to file without confirmation is refused outright while your
firm has not enabled that, rather than being accepted and quietly doing something else.

The screens for all of this are still being built; what a rule does once it exists is described in
[Filing email to a matter](features/filing-email-to-a-matter.md).
- **You can now record that a bill went out — and show it.**

Say how the client got it (posted, handed over, emailed, or submitted to their e-billing portal), who
received it, the date it reached them, and whether it arrived. Record it whenever you like: a bill
you posted last Tuesday carries last Tuesday's date, not today's.

Magna Carta does not send the bill for you. That is the point of recording it this way — most bills
go out by means you arrange yourself, and what matters is being able to show the client got it, not
which system carried it.

**Every attempt is its own permanent record.** A bill sent twice has two. A letter that came back
followed by a successful re-send reads as exactly that. Nothing you record is edited or deleted
afterwards, which is what makes it worth having when a client disputes a fee years later.

**And it shows up where it matters.** When you are about to take your fees out of a client's trust
money, the bill tells you whether there is any record of the client having received it — several
places expect that before fees come out of trust. It does not stop you. It tells you, and the
decision stays yours.
- **Your firm can now tune when an auto-file rule stops itself.**

A rule that suddenly starts firing far more often than a person would — a mailing list, a bounce
loop, an autoresponder — goes back to staging and asks to be looked at. So does a rule whose recent
filings you keep undoing. Out of the box that is twenty-five filings in an hour, or three of the last
ten undone, and an administrator can move both to suit how much mail your firm handles.

What cannot be done is switching the protection off. The numbers move within a sensible range, and a
rule that runs away always stops.
- **You can now correct a bill that has already gone out — without the bill changing.**

Issue a **credit note** against it and say why, in your own words. What you credit comes off what
the client still owes; if they have already paid, the part the bill can no longer absorb is recorded
as money the firm owes them back, and that credit stays visible until you give it back. You can set
it against any later bill for the same client, refund it, or return it to their trust account —
whichever your agreement calls for. A matter will not close while a credit is still open.

**Write off** a balance you have decided not to chase, with the reason. It is kept separate from a
credit note on your books, because giving up on money you were owed is a different fact from
conceding you should not have charged it.

**Undo** a payment or credit recorded against the wrong bill or the wrong matter. The original stays
readable and the reversal is a new record linked to it.

**And if a settlement collapses after you have billed your contingency share**, ask the matter for
its contingency position. It compares what you have actually billed against what the surviving
recovery now entitles you to, reports the difference, and names each bill that carries the fee and
what it still owes — so you can see, before you raise anything, whether a correction would reduce a
debt or leave you owing money back. Nothing is issued for you: what a client is owed when a case
falls apart is your call.

The bill itself never changes. It keeps its number, its lines, and its wording forever, and every
correction stands beside it on the record.
- **Magna Carta now notices when your records change under a matter you have already screened, and
re-runs the check itself.**

Six kinds of change set one off: a party added to a matter; two directory records merged into one; a
name added or changed; a relationship recorded; a tax or social security number entered; and somebody
joining the firm. A scheduled sweep re-screens your open matters weekly on top of that, because a list
of triggers is a list, and any list can turn out to be incomplete. Adding a person to your directory
on its own does **not** set one off — otherwise importing two thousand contacts would re-screen your
entire caseload for no possible new result.

The part that matters most is not the speed. **A matter says a re-check is owed from the moment the
change is recorded**, naming what changed and when — not from whenever the re-check runs. If your
firm's re-screening ever falls behind, the matters waiting say so out loud instead of looking up to
date. A backlog you can see is a different thing from a stale answer that looks fresh.

Several changes to one matter become one search that lists all of them, rather than several searches
or two of three quietly dropped. An automatic check is never credited to a person: it records that it
ran by itself and what set it off.

You are told when an automatic check turns something up — a result at one of the two strongest
evidence levels, or the first result ever on a matter that had none. A check you ran yourself does not
notify you; you are looking at it. The notification says how many results surfaced and how many are
strong, and takes you to the matter. It carries **no names at all**: a notification sits in a feed and
an inbox long after it was sent, and the detail belongs behind the link where your permission to see it
is checked at the moment you look.

And nothing about this decides anything for you. An automatic re-check runs a search and records what
it found. It cannot mark a result reviewed, cleared, or waived — that stays a person's act with that
person's name on it, and the software is built so that it cannot do otherwise.

New guide: [Automatic conflicts re-checks](docs/user/features/automatic-conflicts-rechecks.md).
- **A conflicts check now tells you what it searched, what it could not search, and what nobody has
answered yet — and it will never tell you a matter is safe to accept.**

Every matter has a conflicts position you can read at any time. It answers six questions separately,
because collapsing them into one answer is what loses the information: when the matter was last
checked and under what settings; whether your firm's policy has been widened since, so that the last
check no longer covers everything you now require; which sources could not be searched at all, named,
with the reason; how many results are still waiting for a person to look at them, grouped by strength
of evidence; which results have been decided and by whom; and whether the matter has ever been checked
at all — which is shown as its own answer, never as the same thing as a check that turned up nothing.

The position is worked out fresh every time you look, so widening what a check must cover shows up on
every affected matter straight away, without re-running anything.

A check that turns up nothing now says so in plain words, ending with the sentence **"Nothing
surfaced."** That sentence is about the search. Magna Carta does not show a tick, a score, or a
one-word verdict on whether a matter is safe to take on, and it will not: a search can only look at
what has been recorded, and several things a conflicts search would ideally examine have nothing
behind them yet — the report names each one every time. Describing the procedure is what your firm can
stand behind if it is ever asked how a matter was screened. A verdict the software produced is not.
Deciding remains a lawyer's act, and the record says whose.

New guide: [Conflicts reports](docs/user/features/conflicts-reports.md).
- **A document you build from a template can now be built as a PDF.** Choose "PDF — ready to sign" in
the Build-a-document dialog and the finished document is filed as a PDF rather than a Word document,
which is the form it has to be in before it can be signed. It takes a little longer, because the
document is converted before it is filed.

If the conversion cannot be done, the build fails and says so. You will not be handed a Word document
in place of the PDF you asked for.

### Changed

- **The people whose records you are reviewing are called Custodians of Record.** Same idea, clearer
name: when you say whose files a load came from, that is the Custodian of Record. It stays distinct
from the safe custody register, which is about physical originals the firm holds — you will meet
both in one matter, and neither is ever shortened to just "custodian".

### Fixed

- **A template with Word's old fill-in-the-blank fields now tells you those blanks will not be filled
in.** Registering one lists each field, the prompt its author wrote, and the words the document will
print where it sits — and every document you build from that template reports the same fields and is
marked as needing review before it is filed.

Before this, such a template registered without comment and said it carried nothing to fill in. The
document then came out with the form's own instructions in it, like "Click here to enter caption",
and nothing had warned you.

These fields cannot be filled in automatically, and the system will not guess what one was meant to
mean — the only name Word keeps for such a field is something like "Text1". To bind one, replace it
in Word with a `{{field}}` naming the merge field it should have been.
- **Editing a document in the browser now works.** Opening a document in the editor, taking a copy away
to work on offline, checking it back in, resolving a conflict between two copies, and releasing a
lock somebody else left behind were all built and all refused — every member of every firm was told
they did not have permission, whatever their role. They now sit where the rest of your document work
already does.

Anyone who can upload a document can also edit one and take it offline: that is the Owner/Admin,
Attorney and Paralegal seats. Deciding which of two conflicting copies becomes the real one is
narrower — Owner/Admin and Attorney — because it can set aside somebody else's work. Breaking another
member's lock is narrower still and sits with Owner/Admin alone; a lock nobody is using is released
automatically overnight, so nobody has to wait for an administrator.

**Four groups of tools appear on the Tools page that were never visible to anybody.** Property
listings, county property records, business-entity lookups and attorney-licence lookups are ordinary
public-record links, so every seat sees them, including Read-only. Shipping and postage appears for
Owner/Admin, matching who can already connect the firm's postage account. Several of these still read
"Soon" until their own page is built — what changed is that they are now on the page at all.

Nothing was taken away from anyone: every change here is an addition, and it reaches firms already
using Magna Carta as well as new ones.
- **The Status link in the top bar works.** It opens the live service-status page. The sign-in screen
also drops a line of boilerplate under the card, and the small links beside each field now show the
hand cursor when you hover them.
- **A template built with Word's content controls now tells you those blanks will not be filled in.**
Registering one lists each control by the name its author gave it and the words the document will
print where it sits — and every document you build from that template reports the same controls and
is marked as needing review before it is filed.

Before this, such a template registered without comment and said it carried nothing to fill in. The
document then came out with the control's own prompt in it, like "Click here to enter text.", and
nothing had warned you.

A control you have filled in is left alone and says nothing, because what it holds is your own text.
Controls cannot be filled in automatically yet, and the system will not guess what one was meant to
mean from its name. To bind one, replace it in Word with a `{{field}}` naming the merge field it
should have been.
