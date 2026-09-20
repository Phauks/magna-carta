# Opening and finding matters

_The matters screen is early. The list, the search, the column controls and opening a new matter all
work today. The responsible attorney now shows on the list, but still cannot be set to a colleague
when you open a matter: it is whoever opens it. Opening a consultation, closing a matter and
reopening one all work, from the matter's own page. Editing a matter's details arrives as that
control does._

## What it does

**Matters** in the left-hand navigation is your firm's docket: every matter the firm holds, in one
table you can sort, filter, search and rearrange. It is also where a new matter is opened.

A matter is the file of record for everything the firm does on a case. Documents, time, costs, trust
money and bills all hang from one, so opening the matter is the first step in nearly everything
else.

## Finding a matter

**Search** looks across the matter's title, its number and its client. It searches your firm's whole
record, not just the rows currently on screen, so a matter you have not scrolled to is still found.

**Showing** chooses which part of the docket you are looking at:

| Showing            | What you get                                                                  |
| ------------------ | ----------------------------------------------------------------------------- |
| The working docket | The firm's live caseload. Intakes and consultations are left out.             |
| Open matters       | Only matters that are open.                                                   |
| Closed matters     | Only matters that have been closed. A closed matter is kept, not lost.        |
| Consultations      | Matters the firm has not taken on yet, each with its own consultation number. |

Consultations are deliberately absent from the working docket. A consultation is a file the firm is
still deciding about, and mixing it into the live caseload would overstate how much work the firm
has taken on. Choose **Consultations** to see them. Intakes, the step before a consultation, appear
only on the **Intake** desk in the sidebar (see [`intake.md`](intake.md)).

## Reading the table

Each column header sorts when you press it. Everything else a column can be asked is on its
right-click menu: **Filter** narrows by that column alone, and beside it you can hide the column,
pin it so it stays put when the table scrolls sideways, or open **Columns** for every column the
table can show and the row-striping setting. A column you have hidden has no header left to
right-click, so **Columns** is where you bring it back. A column that is being filtered is marked
in its heading — hover the mark to read what it is narrowed to. Columns can be dragged into the
order you prefer and resized by their edges.

Three columns are worth explaining:

**Matter number.** A matter's number is drawn when it opens and never changes afterwards. A
consultation has not drawn one yet, so the column shows its **consultation number** instead — the
tentative number a consultation is given when its intake completes, or the moment it is recorded
outright, so there is always something to quote on an intake sheet or a conflicts check. An intake
has no number of either kind yet, and its column reads **Intake**. Consultation numbers come from their own sequence,
separate from the firm's matter numbers, and read "C2026-0001" unless your firm has set its own
shape. When the matter is opened it takes a matter number, and the column shows that from then on;
the consultation number stays on the matter's own page, so anything filed under it still finds its
way back.

**Responsible attorney** is the colleague the matter is filed under. A colleague who has left the
firm is still named on the matters they carried — that is who held them. If a matter's cell is
empty, the person it names is not on your firm's member list; the screen leaves it blank rather than
showing you an internal reference number that means nothing.

**Created** is the date the matter was first recorded, which is not always the date it opened. A
consultation recorded in March and opened in June was created in March. The date it opened is on the
matter's own page.

Press a matter's title to open it. Hold Ctrl (or Cmd on a Mac) while pressing to open it in a second
tab, so you can work in two matters at once. Every matter page carries a link back to **Matters** at
its top left, above the matter's name.

If the firm has more matters than fit in one read, **Load more matters** brings in the next set.
Until every matter is loaded, sorting and the column filters cover the ones already on screen, and
the count under the table counts those. The screen says so when that applies.

## Opening a new matter

Press **New Matter**, at the top right beside the search. Only the title is needed; everything else can be filled in later from the
matter itself.

**Title** is what the firm calls the file, in its own words: "Pemberton v. Hale", "Estate of A.
Marsh".

**How it starts** is the one choice worth thinking about.

- **Open the matter and draw its number.** The firm's counter issues the next matter number and the
  matter joins the working docket. This is the usual choice.
- **Start an intake.** The matter is recorded with no number at all and appears on the Intake desk,
  where the firm's intake procedure is answered step by step. This is the usual choice for a new
  caller; [`intake.md`](intake.md) walks through it.
- **Record a consultation.** The matter is recorded with a consultation number rather than a matter
  number, skipping intake, and sits under Consultations until the firm decides to take it. Use this
  when the intake has already happened outside the platform and nothing has been agreed yet. The
  consultation number is shown as soon as the file is recorded.

**Client** is chosen from the firm's Directory. Type three characters of the name and pick the
person or organization; the matter is linked to their record from the moment it exists, whether it
opens outright or is recorded as a consultation, and nothing can be created without one. Someone
not in the Directory yet is added there first. Once a client is chosen, **Open Client Record** takes
you to them, and **Run Conflict Check** searches the firm's record for them before the matter is
created, saying how many hits it found and where to read the report.

**Client code** is your firm's own short code for that client, and matters only if your firm's
numbering scheme uses one.

**Practice area** offers your firm's own list. **Location** is the office the matter is run out of,
chosen from the offices set up under Settings and shown with each one's town and numbering code. Both
are optional: if your firm has not set any up, the form says so and the matter opens perfectly well
without them. Where the matter's paper file ends up is a separate question, answered later on the
matter's own status window.

**Responsible attorney** is the person opening the matter, and cannot yet be changed. Choosing a
colleague waits on the firm member directory; until that exists there is no list of colleagues to
pick from, so the field shows who the matter will open under rather than offering a choice that
would not be real.

## Changing a matter's status

A matter's status is the badge at the top left of its own page, beside the matter number: **Intake**,
**Consultation**, **Active**, **On Hold** or **Closed**. The badge states the status and does
nothing else; pressing it opens the matter's status window.

The window is short on purpose, and it has two sides. On the left, the matter's status, its number
and how the matter is engaged. On the right, the firm's own physical file for the matter. The
bottom of the window offers only **Done**, so a window you opened to read something cannot close a
matter with a press in the corner your hand goes to by habit.

Beside the status is one control, **Change Status**. It opens a panel that lists the steps the
matter can take from where it stands: an intake completes into a consultation; a consultation opens,
is put on hold, or is closed; an active matter closes or is put on hold; a matter on hold is
released or closed; a closed matter reopens. There is no list of statuses to pick from, because a
matter reaches a status by being opened, held, released, closed or reopened, not by being set to
one.

The panel has two sides. The steps are down the left, each carrying one line saying where it
stands: that nothing is in its way, that a requirement is not met, or that this account may not
take it and why. The step you have chosen is discussed down the right — what it would do to the
record, everything it requires with each one already answered, and whatever it asks you for. It
opens on the step the matter runs toward next, so there is always something to read; choosing a
different step on the left rewrites the right and moves nothing else.
The button at the foot reads that step's own verb — **Close Matter**, **Open Matter**,
**Complete Intake**, **Put On Hold**, **Release Hold**, **Reopen Matter** — so what you are about
to do is named where you press it. A step you may not take is shown refused with the reason, never
hidden.

**Putting a matter on hold.** An active matter the firm has stopped working, without ending it, goes
on hold: a client who has stopped paying, a party who has gone quiet, an instruction to wait. Choose
**Put On Hold**, say why in a sentence, and press it. The reason is required, because a matter on
hold with nothing said about why is a matter nobody knows how to resume, and it prints on the
matter's Overview and in the status window under **On Hold**, with the date the pause began. The matter
keeps its number; nothing is drawn or surrendered. It stays on the docket wearing **On Hold** so it
can be found and filtered, and its mail still files to it. Choose **Release Hold** to resume; the
matter goes back to where the hold found it, the reason clears, and the record keeps that it was
held. A matter can also be closed from hold, and reopening it later returns it to the hold it was
in. Both directions need the same permission, `matters:hold`, and a matter cannot be started on
hold: a hold pauses work, so there has to be work to pause.

**A consultation can be parked or declined.** A consultation the prospect is still thinking over
goes on hold the same way, with its reason, and keeps its consultation number; releasing it makes
it a consultation again, never an active matter, because nothing opened it. A consultation the firm
decides against is closed with **Close Consultation**: it keeps its consultation number, draws no
matter number, and stays on the record so a later conflicts check can still find its parties.
Reopening it returns it to being a consultation. An intake cannot be put on hold: it is the walk
toward a consultation, and there is nothing yet to pause.

**Requirements to close** lists what has to be true, each one already answered. Magna Carta runs
the firm's own rules against the matter as the panel opens, so a requirement is marked met or not
before you press anything; nothing here is yours to tick. Where one is not met, the rule says in its
own words what is in the way, and the **Close Matter** button stays disabled: there is nothing to be
gained from a press whose refusal is already on the screen. Clear what it names, open the panel
again, and it is asked again.

Two requirements stop a close, and both are about money that is not the firm's.

**Money still in the client's trust ledger.** A client ledger has to reach zero before its matter
closes, and a hold on disputed funds stops a close even where the ledger is otherwise empty. The
panel names the amount, the trust account it sits on, and the ways out: disburse the remaining funds
to the client, or transfer earned fees to the operating account.

**A client credit the firm has conceded.** This is money a correction left over, which the firm has
already agreed it owes back. The panel names the amount and the date the credit note opened it, and
the ways out: refund it from the operating account, return it to the client's trust ledger, or set it
against another of this client's bills.

An unpaid bill does **not** stop a close. An uncollectable receivable is an ordinary business
outcome, and writing it off is its lawful exit.

**Completing an intake** draws the consultation number once every required step of your intake
procedure is answered; the panel lists what is outstanding under **Requirements To Complete
Intake**, with a way through to the Intake section where they are answered. **Opening a consultation** draws your firm's next matter number, which then stays with the
matter for good, and moves it into the working docket. **Reopening a matter** returns it to the
status it held before it closed — On Hold if it was on hold, Active if it carries a matter number,
Consultation if it carries a consultation number, and Intake if it carries neither — and clears the
recorded close date.

**The matter's number** sits under **Number** in the same window, with the consultation number
beside it where the matter had one. On a matter that has been active it is a field holding the
number the matter wears: type over it and press **Record** to put a court's number, a number from
the firm's previous system, or a correction on the record. Nothing moves when you do — the field is
there before you touch it. It has to be unique in the firm and able to stand in a link, and it
touches no counter; the number it replaces stays on the record. It needs the `matters:renumber`
permission, and without it the number reads instead of being offered. An intake or a consultation
shows that the number is drawn when the matter opens, and cannot be given one by hand.

**Notices are not refusals.** A close can report things worth knowing without stopping: if the firm
still holds a client's property in the safe-custody register against the matter, the panel says so
after the matter closes. The property stays exactly where it is, listed in the register, until
somebody moves, releases or destroys it.

**"This step needs the matters:close permission."** Closing, opening, holding and reopening are
each a permission your firm grants, and this account does not have that one. The step still shows
on the status menu, greyed, with this line under the list, so you can see what the matter could do
and who to ask. Ask whoever administers your firm.

### The physical file

The right-hand side of the window is your firm's own paper file for the matter: the **location** it
is kept at, what it is **held in**, and the date the file may be **destroyed after**.

**Location** is one of your firm's offices, chosen in a field that is there at rest: press it for
the list, or type to search it. Each office is shown with its town and its numbering code, so two
offices in the same city are told apart. What you choose is recorded straight away, and the line
under the field takes you to that office's own record, with its address, its telephone and who
works there. You can also empty the field and record nothing, which is the right answer when nobody
knows where a folder has got to; a guess left standing is worse than a gap. An account without the
permission to change it reads the office as a link instead.

This is the office the **file** is kept at, not the office the matter is run out of. They are
commonly the same, and they are not the same fact: a matter opened at one office is often boxed at
another, or at a records store your firm keeps as an office of its own, and the matter's own office
is the one cited under its title at the top of the page. Recording where the file is moves neither
the matter nor anything else about it.

Setting it needs the permission your firm grants for editing a matter's details. Without it the
button is greyed, with the line saying which permission to ask for.

**Held in** and **destroy after** are not recorded in Magna Carta yet, so each reads "Not recorded"
and carries the Soon mark rather than being left off the screen that ought to answer for them.

**Held in** does not assume a box. Firms keep files in boxes, in cabinet drawers, in safes, on
shelves; what holds a file will be a record in its own right, carrying what kind of thing it is, and
a matter will point at it. That is also why it is not simply part of the location: one container
holds several matters' folders at once.

**Destroy after** waits on something more than a screen. Magna Carta runs no retention timer, and a
date invented here would be the date somebody destroys a client's file on. It stays empty until your
firm's own retention rules are something the product can read.

The panel sits beside the status rather than under the close because closing a matter does not move
its file. A folder stays where it is whatever the matter's status is.

This is deliberately not the safe-custody register, which is a different thing: **Custodian** holds a
client's own property left with the firm to guard, and it stays there for as long as the client's
affairs need it, long after the matter that brought it in has closed.

## If a matter will not open

**"No active numbering scheme is configured."** A matter draws its number from your firm's numbering
scheme, and the firm has not set one up. An administrator sets it in **Settings › Practice ›
Numbering** ([`../admin/numbering.md`](../admin/numbering.md)). Recording the file as a consultation instead still works: consultations number
themselves from a built-in sequence until the firm sets its own, so a file can always be taken down
while the numbering is being decided.

**"Opening a matter is not available to this account."** Opening matters is a permission your firm
grants, and this account does not have it. Ask whoever administers your firm.

Nothing is ever half-created. If opening a matter fails, no matter was made, and pressing the button
again after fixing the cause is safe.

## Related

- [A matter's documents](matter-documents.md) — the Files page on a matter you have opened.
- [Conflicts reports](conflicts-reports.md) — what a conflicts check on a new matter searched.
