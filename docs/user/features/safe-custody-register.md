# Safe custody register

_You can browse the register, walk the location tree, open a packet, log a new packet, describe what
is inside one, and file copies against it. Check-out, check-in, release and destruction are recorded
through the API and their screens are authored when those surfaces ship; the controls for them are on
the packet and say what they are waiting on. Emailed reminders, printed receipts, and client-portal
visibility are not built yet, and the by-owner, holds and overdue reports have no screen today._

## What it does

Keeps track of the physical originals your firm holds for people: wills, deeds, share certificates,
passports, keys, sealed instructions. For each one the register answers three questions at any moment
— **what do we hold, where is it, and whose is it** — and keeps a permanent record of everywhere it
has been.

The register is built around two ideas worth knowing before you use it.

**A packet is what you hold; an item is what's inside it.** The packet is the physical thing that
moves: an envelope, a deed box, a sealed wallet. The items are what it contains — "original will of
Jane Smith dated 14 March 2019", "share certificate, 200 ordinary, Acme Holdings". You move a packet;
you describe items. A packet can start with nothing itemized and be filled in later.

**Every packet belongs to somebody named.** You cannot log a packet without linking it to a person or
organization in your directory. This is deliberate and there is no way around it: the worst thing that
happens in safe custody is not a misplaced envelope, it is an envelope nobody can attribute — one that
can never be returned to its owner and never be destroyed.

## Logging something into custody

1. Open the register and press **New Packet**, at the top of the screen beside the search.
2. Give it a name you would recognize on a shelf ("Smith family deeds").
3. Link at least one **owner** from the directory. You can add more than one — a joint will packet has
   two — and you can give each a short role: owner, joint owner, life tenant, trustee, executor.
4. Choose the **container** it is going into — the safe, box, or shelf it will live in. Type any part
   of its name to narrow the list. Containers you have closed are not offered. If the one you need is
   not there yet, type its name and choose **Add**: say what kind of container it is and what it is
   inside, then press **Add Container**. The first time your firm logs a packet, the form opens
   straight onto this.
5. Record who **handed it over** if it was not the owner, and when. A son depositing his mother's
   will, or a former solicitor transferring a file on a practice closure, is a fact about the deposit
   that should not be lost when ownership later changes. The date is the day the firm actually took
   it, which is often years before anybody types the row.
6. Link a **matter** only if there is one. Most packets have none, and that is normal: a will held for
   a client whose last matter closed eleven years ago is the ordinary case, not an oversight. Where a
   packet is linked to a matter, closing that matter tells the person closing it that you still hold
   the property — and then closes the matter anyway. It never blocks, because holding a client's will
   long after their last matter closed is what a safe-custody register is for. Pressing **New Packet** from
   inside a matter's Custodian section fills this in for you and asks you everything else.
7. Press **Save**. The register draws the packet's custody number.

The form will not let you record a packet without a name, an owner and a container, and it tells you
which of the three is missing rather than leaving a button greyed out with no reason.

If your firm has written down its own list of ownership roles, the role you choose has to be one of
them, so a typo does not become a new category. If it has not, anything you type is accepted — the
platform has no list of its own, because the forms property can be held under vary by jurisdiction.

The register gives the packet a **custody number** — the number you write on the label and read out
over the phone. If you are moving in from a paper deeds register or another system and your packets
already have numbers on their labels, enter the existing number instead; the register will use it and
you do not have to re-label the safe.

Then itemize it: open the packet, go to **Contents**, and press **Describe An Item** once per thing
inside, with a description, the type, and the item's own date where it has one (a will's date is what
people actually search by). A declared value is not asked for on this form, because the firm has not
told the platform what currency it works in and a figure of record is not something a screen should
guess at.

**Irreplaceable originals are flagged.** Most types — wills, deeds, certificates — are flagged
automatically as irreplaceable, and you can set or clear the flag on any specific item. The flag is
what stops an original from ever being destroyed on a schedule, so set it honestly.

## Where things are kept

Your storage is described as a tree: an office holds rooms, a room holds safes, a safe holds boxes, a
box holds positions. You choose how deep to go — a firm with one safe and numbered pigeonholes needs
two levels.

You add a container from the **Container** field of the New Packet form, at the moment you need it.
Put it inside one of your offices, inside another container, or on its own.

**Not everything is in your office.** A bank safe-deposit box, an offsite records vendor, or a
co-trustee's premises can each be added as its own top-level location with its own address. These are
not offices, so they never appear in your firm's office lists, letterhead, or reporting.

A location can be closed when you stop using it, but **not while anything is still in it** — the
register will tell you how many packets are there. Move the contents somewhere first.

## Checking something out, and getting it back

Recording a check-out takes one step, and it always captures **who has it**:

- a member of your firm (a partner taking a deed to a completion meeting),
- someone from your directory (the client's accountant collecting a share certificate), or
- a named individual with no directory record (a courier's driver signing for it).

Give it a **due-back date**. This is the one field that does the most work in the whole register: the
overdue list is built from it, and it is the reason you find out that a deed has been in someone's
office for five weeks.

While it is out the packet reads **On loan**, which is deliberately not the same word as
**Released**. A loan is still yours and has a date against it; a release has ended your custody for
good and is the one step you cannot undo. They are the two states in which something is not on the
shelf, and they are opposites.

Checking it back in records where it went back to. You can also move a packet between locations, take
a single item out of a packet, give an original back to its owner for good (see below — that one
takes more), or record that something is **lost** — recording a loss honestly is far better than a
register that quietly cannot say.

Every one of these is written into the packet's history with the date it actually happened, which may
be earlier than the day you type it in. Back-dating is supported and expected: a Friday collection
entered on Monday is the normal case.

**History is never edited.** If you record something wrongly, you record a **correction** that points
at the entry it corrects. Both stay visible. That is what makes the register worth something if it is
ever questioned — nobody could have gone back and made it say something else.

**Each item has a chain of custody too.** Open a packet, go to Contents, and click an item: its own
history opens underneath it. It shows what happened to that item and everything that happened to the
packet holding it, because an original will inside a deed box went to the Reno safe when the box did.
Entries about the whole packet say so, so a move of the box is never mistaken for something that
happened to this will alone. The packet's own history works the other way round: an entry about one
item names which item, rather than leaving you to guess which of five instruments was withdrawn.

## Giving an original back

Handing an original over for good is the one thing the register will not let you record casually, and
it is the only one. Everything else — moving a packet, checking it out, checking it back in — takes
one step, because a register that makes the daily work slow is a register people stop keeping. A
release is different because it is the only step you cannot undo. Once the deed is in someone's hands
the two questions anyone will ever ask are the same two: on what authority did it leave, and how did
you know that was the right person.

So recording a release asks for three things, and refuses without them:

- **Who collected it** — a member of your firm, someone from your directory, or a named individual.
- **The authority it is going out on**, in your own words. "Owner collecting in person." "Grant of
  probate dated 3 March 2026, original sighted." The register does not have a list of acceptable
  answers and never will: what authority suffices varies by jurisdiction, and a list we invented would
  be wrong somewhere. What it does is make sure you wrote something, and then keep it.
- **How you checked they are who they say they are.** The member who did the checking is _you_ — the
  register records whoever is signed in and recording the release, and there is no field for naming
  somebody else. An identity check is something you did with your own eyes, so it is not a claim you
  can enter on a colleague's behalf.

**Record the check, not the document.** "Photographic identification checked against the directory
record" is the right thing to write. A passport number is not: this goes onto the packet's permanent
history, which cannot be edited or deleted by anyone, ever, and nothing about the register needs it.

**Two signatories, if your firm wants them.** Your firm can require a second person to sign an
original out of the safe. It is off unless you turn it on, because a small office where one person is
the only person in the building cannot work under a rule imposed on it from outside — and the two
signatories have to be two different people, which is the whole point. The witness has to be somebody
your firm actually employs and who is still active: a colleague who has left, or an identifier
belonging to nobody, is refused. Everything above applies whether or not you turn it on.

None of this applies to a check-out. Lending a deed to a partner for a completion meeting is
reversible, and it stays a single step.

## Holds

Put a **hold** on a packet or an item when it must not leave: a legal hold, a discovery hold, a client
instruction, a dispute, or because you cannot locate the owner.

A hold stops the property being **released or destroyed**. It deliberately does **not** stop you
moving it — a held original still needs to be movable to a fireproof safe or an offsite site. Holds
are released explicitly, and both the placing and the releasing show up in the packet's history.

## Destroying something

Some things a firm holds really are meant to be destroyed one day — superseded copies, duplicate
correspondence, papers a client has asked you in writing to shred. Destroying a client's property is
the one thing in the register that takes **two people**, and the steps are separate on purpose.

1. **Somebody raises a request.** They name the packet, or one item inside it, and write down the
   reason and the authority they are relying on. Nothing happens to the property at this point.
2. **Somebody else approves or refuses it.** It has to be a different person — the register will not
   let one person do both halves, and there is no setting that turns that off. Anyone who can manage
   the register may refuse a request, including the person who raised it: ending a client's property
   takes two people, deciding not to takes nobody's agreement.
3. **Somebody records that it was done**, and what was done — shredded, incinerated, witnessed. That
   goes into the packet's history like every other event, with the name of the person who recorded it.

Once a request has been refused, carried out, or withdrawn, it is finished. If you want to ask again,
raise a new one — the register does not rewrite a decision somebody may already have acted on.

### Two things the register will simply not do

**It will not destroy anything under a hold.** You are told so when you raise the request, and asked
again when you go to carry it out — so a hold placed in between is not stepped over by an approval
that predates it.

**It will not destroy an original of intrinsic value. Ever.** If an item is marked as an irreplaceable
original — a will, a deed, a share certificate, an original grant — every route to destroying it is
closed, and there is no override, no override for administrators, and no way to ask twice. This is the
one rule the platform takes a position on, and it takes it because no jurisdiction's rules produce
"destroy the client's original will because a clock ran out". If a thing genuinely is not an
irreplaceable original, somebody changes that on the item itself — deliberately, on the record, about
that specific object. That is a change to a fact, not a way round a rule.

And the platform still ships **no retention periods at all**. Nothing expires, nothing sweeps, and
nothing suggests that something is due for destruction. Every destruction starts with a person who
wrote down why.

## Will delivery deadlines, where we have checked the law

Holding a client's will comes with a legal duty once that client dies, and it is a duty with real
teeth. The register can show you **what the statute says**, quoted from the statute itself with the
citation, for jurisdictions where the law has been read and verified against the published text.

**Nevada is the first.** For Nevada the register shows:

- **NRS 136.050(1)** — any person holding a will must deliver it within **30 days after learning that
  the person who made it has died**, either to the clerk of the district court with jurisdiction or to
  the personal representative named in the will. The statute says "any person"; there is no separate
  rule for attorneys and no exception for holding under a custody agreement. The clock starts at
  **knowledge** of the death, not at the death.
- **NRS 136.050(3)** — a holder who neglects that duty without reasonable cause is liable to everyone
  interested in the will for the damage caused.
- **NRS 136.050(4)–(5)** — a will delivered to the clerk becomes part of the court's permanent record
  whether or not anybody files for probate, and is then open to public inspection unless it is sealed.
  Delivering to the named personal representative instead does not have that effect. Which target you
  choose is a real decision, and the statute leaves it to you.
- **NRS 136.060** — where a court orders a will produced, the deadline is whatever the order says, and
  a holder who refuses can be jailed until they produce it.
- **Nevada has no lifetime deposit.** There is no way to lodge a will with a Nevada court for
  safekeeping while the client is alive. This is shown explicitly rather than left blank, because
  language from a model act that Nevada never adopted circulates widely enough to be mistaken for
  Nevada law.
- **Lodging the original with a probate petition is a local rule, not a statewide one.** The register
  carries it for the **Eighth Judicial District (Clark County)** and the **Second Judicial District
  (Washoe County)**, which were checked. Nevada's other nine districts have not been checked, so
  asking about one of them tells you that plainly rather than answering as though the state rule were
  the whole story.

**Two things this is not.** It is not legal advice, and it decides nothing the law leaves open —
whether "knowledge of the death" reaches something you arguably should have known, and what counts as
"reasonable cause", are questions for a lawyer and the register does not answer them. And it is not a
countdown: nothing in the register records a client's date of death yet, so the 30 days are shown as
what the statute requires, not as a timer running against a date the platform assumed.

**Anywhere else, you are told so.** Ask about a jurisdiction that has not been researched and verified
and the register says exactly that, rather than showing you a plausible-looking answer. There is no
default and no fallback. A sentence you can check is worth more than a confident one you cannot. A
mistyped jurisdiction is treated as a typo rather than as an answer: case and separators do not
matter, and asking about a county below a state that _has_ been researched tells you which wider
jurisdiction does have a verified answer.

## Scans

You can attach scans, photographs, receipts, appraisals, and correspondence to a packet or to one item
inside it. Upload the document the way you upload any other document, then open the packet, go to
**Scans**, and press **File A Copy** to link it and say which of the five it is.

**A scan is never a substitute for the original**, and the register will not treat it as one. Having a
scan of a will does not make the will itself any more disposable — that is exactly the reasoning that
loses originals, and the register refuses to encode it.

## Looking at things again

Some things need another look every so often — a passport that expires, an envelope you have held for
nine years and should confirm is still where the file says it is. Give a packet, or one item inside
it, a **review date**, and optionally a **cycle** in months.

A review date is not a deadline. Nothing expires when it passes and nothing happens to the property;
the packet simply appears on the list of things waiting. When you have looked at it, record the review
and the date moves forward by your cycle — **on its anniversary, not from today**. A five-year review
done eight months late is still due five years after the original date, so a cycle cannot quietly
drift into a different month every time somebody is busy. If you set no cycle, the review is a one-off
and completing it clears the date.

Recording a review goes into the packet's history like everything else, so "when did we last check
this" always has an answer.

## What the register is waiting on

The register knows what is waiting on it: **reviews that have come round, and things checked out that
have not come back**, oldest first. There is no screen showing that list today — the one there was
stood beside the register as a separate tab, and it went with the others — so this answer is available
through the API and not yet on a page. Nothing emails you either; that arrives when notifications
ship, and it will read from exactly this list.

## Reports

**Holdings by location is the register screen itself.** The storage tree runs down its left-hand side
with counts on every node, both for a single shelf and for everything beneath it, and selecting a node
narrows the register to that whole branch — the safe and every box and position inside it. A packet
that is checked out counts at no location, so a safe whose contents are all out reads as empty, which
is what you would see if you opened it.

Three other reports exist behind the API and **have no screen today**: holdings by owner (per person
or organization, how many packets are in the safe, how many are checked out, how many items are
described, how many are under hold), holds in force, and overdue check-outs. They had one, as three
tabs beside the register, and the tabs came off: two of the three were the register narrowed and
belong to it rather than beside it, and a firm that is not yet using holds or due-back dates was
being shown three empty screens to find that out. They come back when there is a firm using them and
a shape that is not a tab strip.

Nothing you can see is ever a short list wearing a complete one's clothes: the register tells you how
much of itself is on screen and gives you the way to the rest, and the reports above answer a page at
a time with holdings by owner saying when your firm holds for more people than the page names.

## Taking a stocktake

A **stocktake** is a physical count: somebody walks the shelves, records what they actually see, and
the register tells you where it disagrees with them.

Open a count over the whole register, or over one safe, cabinet, or shelf and everything inside it.
Then record what the counters find, as they find it:

- **Seen** — this packet is on this shelf.
- **Not found** — I went to the shelf the register named and it was not there. This is deliberately
  different from simply not having got to a shelf yet, so an unfinished count never looks like a loss.
- **Something unregistered** — there is an object here the register has no entry for. Describe what
  you are looking at; that description is the only record of it anywhere.

Close the count and you get a **reconciliation** — which you can also read at any point while the
count is still running, so a long walk shows its progress:

- **Missing** — the register expected it here and nobody saw it.
- **Misplaced** — somebody saw it, on a different shelf from the one the register names.
- **Unexpected** — somebody saw it where the register did not expect it at all: it is recorded as
  checked out, or as having left the firm.
- **Unregistered** — the objects with no entry.

### A stocktake never changes anything

This is worth being clear about, because it is the point. **Counting changes nothing.** No original
is moved, no status changes, no entry is added to any packet's history, and nothing is ever destroyed
or disposed of. The register is exactly as it was before you counted.

What the reconciliation does is **suggest**. Against a misplaced packet it says "you could record a
move to the shelf it was actually found on"; against one the register thinks is checked out it says
"you could record it as found". Acting on a suggestion means recording that movement yourself, the
same way you record any other — so a person's name is on the correction, which is the whole value of
having noticed.

Against a **missing** original the reconciliation suggests nothing at all, on purpose. An original
that is not where it should be is something to go and look for, and offering to write it off the
moment a shelf comes up empty would be the wrong instinct at exactly the wrong moment.

### Two more things

**What a count found is frozen when you close it.** Put the register right afterwards and the
reconciliation's lists will update to say so — but the numbers the count produced stay as they were.
"The March count found three misplaced" is a fact about March, and it should not quietly become zero
because you fixed them in April.

**A count you never finished is abandoned, not closed.** Abandoning records no findings. A half-done
walk would otherwise read as a safe full of missing originals, which would be alarming and wrong.

**A count too large to read in one pass says so, and will not be closed with numbers on it.** A
reconciliation reads up to ten thousand rows at a time. Past that it tells you it is a partial answer,
and the counts on it are a floor rather than a finding — property beyond the cut was never looked for,
so it was never reported missing either. Narrow the count to one safe or one cabinet and run it again,
or abandon it; what you must not be able to do is file a number that quietly understates what is
missing.

You can also run more than one count at a time — two offices counting two safes on the same Saturday
is ordinary, and each count reports only on what its own counters saw.

## Labels

Print a sheet of labels for packets and locations, at true size on standard A4 24-label stock. Each
label carries the custody number (or the location's name) in large type, the packet name, and a
**barcode**.

Two things worth knowing. You can start part-way down a partly-used sheet, so a sheet with four labels
peeled off is not wasted. And a request prints **one sheet** — if you select more than fits, the
register asks you to print the rest separately rather than quietly sending the overflow to a second
page, because a label that printed somewhere you were not looking is a label that ends up on the wrong
box.

The barcode encodes the item's internal reference rather than the custody number you can read. That is
deliberate: labels stay stuck to boxes in a safe for decades, and a barcode that depended on your
numbering scheme would stop working the day the scheme changed.

## Who can see and do what

- **Reading the register** is available to everyone at the firm. "Do we hold the deed for this client"
  is a question anyone might legitimately need answered.
- **Changing it** — logging packets, moving them, checking them out, placing holds — is limited to the
  people your firm trusts with the safe. By default that is owners and administrators, attorneys, and
  paralegals.

Bear in mind that the register's contents are sensitive on their own. That your firm holds an original
will for a named person is a disclosure even with no document attached, so treat a screen showing the
register the way you would treat the safe itself.

## What is not here yet

- **Emailed reminders.** Nothing is sent to you yet, and the list of reviews and overdue check-outs
  has no screen either — both arrive together.
- **Screens for check-out, check-in, release and destruction.** The rules above are enforced today and
  the record is written through the API; the controls on a packet render with their real words,
  disabled, saying what each is waiting on.
- **Changing a packet after you have logged it.** Editing a packet, and correcting an entry in its
  history, are recorded through the API and have no form yet.
- **Retention periods.** The destruction workflow above exists, but the platform ships **no default
  retention periods** at all — deliberately. How long a firm must keep a client's property varies by
  jurisdiction, and the guidance that matters most says originals of intrinsic value sit outside any
  routine clock. Your firm sets its own; the platform will never quietly decide for you. A review date
  is not a retention clock and never becomes one, and nothing anywhere sweeps for things to destroy.
- **QR codes on labels.** Labels carry a scannable barcode; QR is not printed yet.
- **Printed deposit and release receipts.** The checks made before an original leaves are recorded
  today; producing a receipt document from your own template is not built yet. In the meantime a
  signed paper receipt can be scanned and attached to the packet like any other document.
- **"Items we hold for you" in the client portal.**
- **Will delivery deadlines outside Nevada.** Nevada has been researched and verified against the
  published statutes and court rules. Every other jurisdiction — and nine of Nevada's own eleven
  judicial districts, for the local lodging rule — is not encoded, and asking about one tells you so
  rather than guessing.
- **A running clock on a will.** The register does not record a client's date of death, so it shows
  you what the statute requires rather than counting days against a date nobody gave it.
- **Guidance on which delivery target to choose**, and the Nevada electronic-will custodian role. Both
  are decisions with real consequences that your firm makes, not defaults the platform picks.

## Related

- [Filing email to a matter](filing-email-to-a-matter.md)
- [Shipping & postage](shipping.md) — for sending originals by courier or certified mail
