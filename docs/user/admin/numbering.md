# Numbering

Every record your firm refers to out loud carries a number, drawn the moment the record exists and
never changed on its own: a matter, a consultation, an enquiry, a conflicts check, a custody packet,
an invoice, a time entry, a call. Under **Settings › Practice › Numbering** an administrator sees
every one of those sequences in one place and decides what shape the ones the firm can shape take.

## The sequences

Each sequence has its own plate on the page, in this order:

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
- **Custody Numbers**: drawn when a packet is logged into custody, unless a number carried in from a
  paper register is recorded instead. `CUS-00001` and so on, firm-wide, until the firm sets its own
  shape.
- **Invoice Numbers**, **Time Entry Numbers** and **Call and Text Numbers** have a fixed shape and
  are stated on the page for completeness: a five-digit count per letterhead scope, the matter's own
  number with a four-digit count, and the day with a four-digit count. They are listed so the page
  is the whole inventory; the plate says why each shape is fixed.

The first five are the firm's to shape. Until the firm has set a matter numbering scheme, a
consultation cannot be opened as a matter: there is no shape to draw its number in. Every other
sequence numbers itself from its built-in shape until the firm sets its own, so a file, a check or a
packet can always be taken down while the numbering is being decided.

## Writing a scheme

A scheme is an ordered list of parts. Each part is one of:

- **Text**: a fixed piece, such as a dash or a prefix. Letters, digits and `. _ ~ -` only, so the
  number can stand in a link.
- **Counter**: the part that ticks up with each number drawn. Every scheme has exactly one. Choose
  how many digits it is padded to and what it starts at. The digits are a floor, not a ceiling: a
  run that passes its width grows a digit rather than stopping, so no sequence ever runs out.
- **Year**, as four digits or two, or **Date Opened** as eight digits, taken from the day the
  record was numbered.
- **Office Code**, **Practice Area Code**, **Client Code**, **Attorney Initials** or **Client
  Name**, taken from the matter. Only the matter, consultation and intake sequences offer these: a
  conflicts check or a custody packet carries none of them at the moment it is numbered. A matter
  that lacks the value a scheme needs cannot open under that scheme; the window that opens it says
  which part has no value.

Any part taken from the record can be set to **restart the count**: the counter then begins again
for each distinct value of that part, so a year that restarts the count gives `2026-0001`,
`2026-0002` and then `2027-0001`, and a practice area that restarts it gives each practice its own
run.

**In Force** states the scheme the firm is numbering under today, or says that nothing is set and
what that means; a plate numbering from its built-in shape says so. The **Matter Numbering
Scheme** field (or **Conflicts Check Numbering Scheme**, and so on) offers the common shapes;
choosing one loads it into the parts below, and every part is then yours to change.

The parts are a table, one row per part. The arrows at the start of a row move it up or down; the
**Part** column chooses what kind of part it is; **Text**, **Digits**, **Starts At** and **Restarts
The Count** hold the facts that kind takes, and a column a part has no fact for is greyed with the
reason shown when you hover it; the control at the end of the row removes it. **Add Part** adds a
row at the end.

The **Preview** row is rendered by the same machinery that draws real numbers, against a sample
record whose values are printed under it, so what you see is what the next record will get. **Save
Scheme** replaces the firm's scheme in one audited step; **Discard** returns the parts to the scheme
in force.

**A number already drawn is frozen.** Saving a scheme reaches only the records numbered from then
on. Nothing already numbered is renumbered, and nothing here changes a single record's number. A
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

## Who can change it

Reading and changing the schemes needs the `matters:manageNumbering` permission. Setting a matter's
number by hand needs `matters:renumber`. Both are granted to the Owner/Admin role.
