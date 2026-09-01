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

| Showing            | What you get                                                           |
| ------------------ | ---------------------------------------------------------------------- |
| The working docket | The firm's live caseload. Consultations are left out.                  |
| Open matters       | Only matters that are open.                                            |
| Closed matters     | Only matters that have been closed. A closed matter is kept, not lost. |
| Consultations      | Matters the firm has not taken on yet, which carry no number.          |

Consultations are deliberately absent from the working docket. A consultation is a file the firm is
still deciding about, and mixing it into the live caseload would overstate how much work the firm
has taken on. Choose **Consultations** to see them.

## Reading the table

Each column header sorts when you press it, and carries a small funnel that filters just that
column. **Columns** at the right chooses which columns show, pins one so it stays put when the table
scrolls sideways, and turns row striping on or off. Columns can be dragged into the order you prefer
and resized by their edges.

Three columns are worth explaining:

**Matter number.** A matter's number is drawn when it opens and never changes afterwards. A
consultation has not drawn one yet, so its cell reads "Consultation" rather than sitting empty.

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

Press **New matter**. Only the title is needed; everything else can be filled in later from the
matter itself.

**Title** is what the firm calls the file, in its own words: "Pemberton v. Hale", "Estate of A.
Marsh".

**How it starts** is the one choice worth thinking about.

- **Open the matter and draw its number.** The firm's counter issues the next matter number and the
  matter joins the working docket. This is the usual choice.
- **Record a consultation, unnumbered for now.** The matter is recorded without a number and sits
  under Consultations until the firm decides to take it. Use this when someone has approached the
  firm and nothing has been agreed yet.

**Client** is the client's name as it should print. Linking the matter to a full Directory record is
a separate step, done on the matter's Parties page.

**Client code** is your firm's own short code for that client, and matters only if your firm's
numbering scheme uses one.

**Practice area** and **Location** offer your firm's own lists. If your firm has not set any up, the
form says so and the matter opens perfectly well without them.

**Responsible attorney** is the person opening the matter, and cannot yet be changed. Choosing a
colleague waits on the firm member directory; until that exists there is no list of colleagues to
pick from, so the field shows who the matter will open under rather than offering a choice that
would not be real.

## Changing a matter's status

A matter's status is the badge at the top left of its own page, beside the matter number: **Active**,
**Prospective** or **Closed**. Press the badge to change it.

The window is short on purpose. It states the matter's status, what closing requires and whether
each requirement is met, and what becomes of the paper file, and it offers the one step the current
status allows: a consultation opens, an active matter closes, a closed matter reopens. There is no list of statuses to pick from,
because a matter reaches a status by being opened, closed or reopened, not by being set to one.

**Requirements to close** lists what has to be true, each one already answered. Magna Carta runs
the firm's own rules against the matter when the window opens, so a requirement is marked met or not
before you press anything; nothing here is yours to tick. Where one is not met, the rule says in its
own words what is in the way, and the **Close Matter** button stays disabled: there is nothing to be
gained from a press whose refusal is already on the screen. Clear what it names, reopen the window,
and it is asked again.

Two requirements stop a close, and both are about money that is not the firm's.

**Money still in the client's trust ledger.** A client ledger has to reach zero before its matter
closes, and a hold on disputed funds stops a close even where the ledger is otherwise empty. The
window names the amount, the trust account it sits on, and the ways out: disburse the remaining funds
to the client, or transfer earned fees to the operating account.

**A client credit the firm has conceded.** This is money a correction left over, which the firm has
already agreed it owes back. The window names the amount and the date the credit note opened it, and
the ways out: refund it from the operating account, return it to the client's trust ledger, or set it
against another of this client's bills.

An unpaid bill does **not** stop a close. An uncollectable receivable is an ordinary business
outcome, and writing it off is its lawful exit.

**Opening a consultation** draws your firm's next matter number, which then stays with the matter for
good, and moves it into the working docket. **Reopening a matter** returns it to the status it held
before it closed, which is Active if it carries a number and Prospective if it does not, and clears
the recorded close date.

**Notices are not refusals.** A close can report things worth knowing without stopping: if the firm
still holds a client's property in the safe-custody register against the matter, the window says so
after the matter closes. The property stays exactly where it is, listed in the register, until
somebody moves, releases or destroys it.

**"This step needs the matters:close permission."** Closing, opening and reopening are each a
permission your firm grants, and this account does not have that one. Ask whoever administers your
firm.

### The physical file

**Physical file** and **Destroy after** are on the window and are not filled in yet. They are about
your firm's own paper file for the matter: where it sits once the matter is closed, and the date it
may be destroyed. Neither is recorded anywhere in Magna Carta today, and the window says so rather
than leaving the questions off the screen that ought to answer them.

They are deliberately not the safe-custody register, which is a different thing: **Custodian** holds
a client's own property left with the firm to guard, and it stays there for as long as the client's
affairs need it, long after the matter that brought it in has closed.

## If a matter will not open

**"No active numbering scheme is configured."** A matter draws its number from your firm's numbering
scheme, and the firm has not set one up. An administrator sets it in **Settings**, under **Matter
numbering**. Recording the file as a consultation instead needs no scheme, because a consultation is
unnumbered until the firm opens it.

**"Opening a matter is not available to this account."** Opening matters is a permission your firm
grants, and this account does not have it. Ask whoever administers your firm.

Nothing is ever half-created. If opening a matter fails, no matter was made, and pressing the button
again after fixing the cause is safe.

## Related

- [A matter's documents](matter-documents.md) — the Files page on a matter you have opened.
- [Conflicts reports](conflicts-reports.md) — what a conflicts check on a new matter searched.
