# Numbering

Every record your firm refers to out loud carries a number, drawn the moment the record exists and
never changed on its own: a matter, a consultation, an enquiry, a conflicts check, a custody packet,
an invoice, a time entry, a call. Under **Settings › Practice › Numbering** an administrator sees
every one of those sequences in one place and decides what shape the ones the firm can shape take.

## The sequences

Each sequence folds open on the page, in this order. Closed, the page is the whole inventory: every
sequence's name beside the number it is issuing today.

- **Matter Numbers**: drawn once, when a matter opens, and frozen from then on. An intake and a
  consultation carry no matter number: a caller the firm never takes on must not consume one,
  because a gap in the run of matter numbers reads as a lost file. A matter on hold keeps the number
  it drew.
- **Consultation Numbers**: drawn when an enquiry becomes a consultation, from a run of its own, and
  kept beside the matter number once the matter opens. `C2026-0001` and so on until the firm sets
  its own shape.
- **Intake Numbers**: drawn the moment an enquiry is written down, from a third run, and kept beside
  every number the file draws later. `I2026-0001` and so on until the firm sets its own shape.
- **Conflicts Check Numbers**: drawn the moment a check is opened; every run of the check belongs to
  the same number. `CC2026-00001` and so on, restarting each January, until the firm sets its own
  shape. Checks are the busiest run a firm has, since every intake, every new party and every
  automatic re-check opens one, which is why the built-in shape restarts each year and carries five
  digits.
- **Custody Packet Numbers**: drawn when a packet is logged into custody, unless a number carried in from a
  paper register is recorded instead. `CUS-00001` and so on, firm-wide, until the firm sets its own
  shape.
- **Invoice Numbers**, **Time Entry Numbers** and **Call and Text Numbers** have a fixed shape and
  are stated on the page for completeness: a five-digit count per letterhead scope, the matter's own
  number with a four-digit count, and the day with a four-digit count. An invoice number is a run
  the firm's auditors read, so it takes no template; a time entry is read against the matter it
  belongs to, so it carries that matter's number; a call's number carries the day so a reader
  knows when it happened without a lookup, and a firm-wide run would reach five digits inside a
  year. They are listed so the page is the whole inventory.

## Draft numbers while a record is being created

A window that creates a numbered record shows the number the record will be saved under before you
save it, in italics: a new matter, intake or consultation, a new conflicts check, a new custody
packet, and each call or text being written down. Point at the number to see what the italics mean.

- **The number is held for you.** Somebody else creating the same kind of record at the same moment
  is shown the next number, not yours, so the number you read out is the number the record gets.
- **Cancelling gives the number back.** Close the window without saving and the next record of that
  kind takes the number, so the run has no gap. A window left open and forgotten, or a tab that
  closes, gives its number back after fifteen minutes on its own.
- **Changing what you are creating changes the number.** Switching a new matter from Intake to
  Consultation, or changing the day a call happened, gives the first number back and shows one from
  the right run.
- Because a number can be given back, a run fills in order of numbers rather than strictly in the
  order records were saved: a matter numbered 0007 may be saved a minute after 0008.

**Invoice numbers are never held.** A bill is numbered when it is finalized, all at once, so an
invoice run stays both gapless and in the order the bills were issued. Time entries are numbered as
they are captured and have no window to hold a number for.

The first five are the firm's to shape. Until the firm has set a matter numbering scheme, a
consultation cannot be opened as a matter: there is no shape to draw its number in. Every other
sequence numbers itself from its built-in shape until the firm sets its own, so a file, a check or a
packet can always be taken down while the numbering is being decided.

## Writing a scheme

A scheme is an ordered list of parts. Each part is one of:

- **Text**: a fixed piece, such as a dash or a prefix. Letters, digits and `. _ ~ -` only, so the
  number can stand in a link.
- **Counter**: the part that ticks up with each number drawn. Every scheme has exactly one. Choose
  the fewest digits it is written with and what it starts at. A new counter is written with one
  digit, which means no padding at all: `3333-9` is followed by `3333-10`. Set it to 4 for
  `0001`-style numbers. The digits are a floor, not a ceiling: a run that passes its width grows a
  digit rather than stopping, so no sequence ever runs out.
- **Year**, as four digits or two, or **Date Numbered**, taken from the day the record was numbered.
  Date Numbered is the year, month and day joined by the separator you choose: `2026.11.11` with a
  period, `2026-11-11` with a dash, or `20261111` with none.
- **Office Code**, **Practice Area Code**, **Client Code**, **Attorney Initials** or **Client
  Name**, taken from the matter. A client code can be letters or digits: `ASH` or `3333`. A client
  name has its accents folded out and its words joined by the separator you choose, so Ashford
  Holdings reads `Ashford-Holdings` with a dash. Only the matter, consultation and intake sequences offer these: a
  conflicts check or a custody packet carries none of them at the moment it is numbered. A matter
  that lacks the value a scheme needs cannot open under that scheme; the window that opens it says
  which part has no value.
- **Office Code** on an invoice number is the one exception: it is the code of the letterhead the
  bill is issued under. Add it only if your firm issues bills under more than one letterhead. Once
  an invoice number prints it, every bill has to be issued under a letterhead, and a bill that
  names none is refused with a message saying so.

Where a sequence already counts within something (a time entry within its matter, an invoice
within the letterhead it was issued on) no part can take a separate count, and the column says so.
Everywhere else, any part taken from the record can be given a **Separate Count**: each distinct
value of that part then keeps its own run. With **Client Code**, **Text** `-` and a **Counter**,
and Separate Count on for the client code, client 3333's matters are `3333-1`, `3333-2`, `3333-3`
while client 4444's start again at `4444-1`. With it off there is one count across the firm, and the
client code is only a label in front of it: `3333-1`, `4444-2`, `3333-3`. A year with a separate
count gives `2026-0001`, `2026-0002` and then `2027-0001` in January.

Numbers like these sort the way you read them everywhere in the product: `3333-2` comes before
`3333-10`, so there is no need to pad a count with zeros just to keep a list in order.

**Current** shows the number the firm is issuing today, and **Preview** directly under it shows the
number your edit would issue, so the two can be compared at a glance. Where nothing is set, Current
says so and what that means.

The parts are a table under the preview, one row per part, in the order they appear in the
number. To move a part, drag it by the grip at the start of its row; from the keyboard, focus the
grip and press Alt with Arrow Up or Arrow Down. The **Part** column chooses what kind of part it is,
from a list in alphabetical order that shows beside each choice what that part would put into the
number. **Value** holds the text of a fixed piece, and for every other kind states what that part
will put into the number. **Format** holds the counter's fewest digits, a year's 4 or 2 digits, and
the separator for Date Numbered and Client Name (Dash, Period, Underscore, Tilde or None; a slash
cannot be used because the number has to stand in a link). **Starts At** and **Separate Count** hold
the rest, and a column a part has no fact for is empty with the reason shown when you hover it. The
control at the end of the row removes the part. The table fits beside the settings list on any
screen 1220 pixels wide or wider; on a narrower window, collapsing the main sidebar gives it room.

Under the last part, **Add Part** adds one at the end.

The preview is rendered by the same machinery that draws real numbers, against a sample record, so
what you see is what the next record will get. **Save Scheme** replaces the firm's scheme in one
audited step; **Discard** returns the parts to the scheme in force.

**Numbering Scheme only affects future generation.** Saving a scheme reaches only the records
numbered from then on. Nothing already numbered is renumbered, and nothing here changes a single record's number. A
conflicts check numbered `CC-0042` before the firm's checks joined this page keeps that number.

## Setting one matter's number by hand

A court's number, a number from the firm's previous system, or a correction is set on the matter
itself: open the matter, press its status badge, and under **Number** press **Set Number** (or
**Change Number** where one is already recorded). The number has to be unique in the firm and able
to stand in a link. It touches no counter, so the next matter opened still draws the next number in
the run, and the number it replaces stays on the record so a filing that quoted it still resolves.

The control is offered only on a matter that has been active. An intake or a consultation cannot be
given a matter number by hand any more than by the counter: no matter number exists before a matter
is active. A custody packet takes a carried-in number the same way, when it is logged.

## Who can see and change it

Every member sees the page: what is in force for each sequence, stated as a fact, with **Request a
change** beside it (`matters:viewNumbering`, granted to every role). Changing a scheme needs the
`matters:manageNumbering` permission, and setting a matter's number by hand needs
`matters:renumber`; both are granted to the Admin role.
