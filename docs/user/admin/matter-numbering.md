# Matter numbering

Every matter your firm takes on gets a number the moment it becomes active, and that number never
changes on its own. Under **Settings › Practice › Matter Numbering** an administrator decides what
shape those numbers take, and what shape the tentative numbers your consultations carry take.

## When a number is drawn

A matter number is drawn once, when a matter opens, and is frozen from then on. An intake and a
consultation carry no matter number: a caller the firm never takes on must not consume one, because
a gap in the run of matter numbers reads as a lost file. A consultation carries its own number, from
its own sequence, so it can be named on an intake sheet or a conflicts report. A matter on hold keeps
the number it drew.

Until the firm has set a matter numbering scheme, a consultation cannot be opened: there is no shape
to draw its number in. Consultations number themselves from a built-in sequence (`C2026-0001`, and
so on) until the firm sets its own, so a file can always be taken down while the numbering is being
decided.

## Writing a scheme

A scheme is an ordered list of parts. Each part is one of:

- **Text**: a fixed piece, such as a dash or a prefix. Letters, digits and `. _ ~ -` only, so the
  number can stand in a link.
- **Counter**: the part that ticks up with each number drawn. Every scheme has exactly one. Choose
  how many digits it is padded to and what it starts at.
- **Year**, as four digits or two, or **Date Opened** as eight digits, taken from the day the
  matter opened.
- **Office Code**, **Practice Area Code**, **Client Code**, **Attorney Initials** or **Client
  Name**, taken from the matter. A matter that lacks the value a scheme needs cannot open under
  that scheme; the window that opens it says which part has no value.

Any part taken from the matter can be set to **restart the count**: the counter then begins again
for each distinct value of that part, so a year that restarts the count gives `2026-0001`,
`2026-0002` and then `2027-0001`, and a practice area that restarts it gives each practice its own
run.

Each sequence has its own plate on the page. **In Force** states the scheme the firm is numbering
under today, or says that nothing is set and what that means. The **Matter Numbering Scheme** field
(or **Consultation Numbering Scheme**) offers the common shapes; choosing one loads it into the
parts below, and every part is then yours to change.

The parts are a table, one row per part. The arrows at the start of a row move it up or down; the
**Part** column chooses what kind of part it is; **Text**, **Digits**, **Starts At** and **Restarts
The Count** hold the facts that kind takes, and a column a part has no fact for is greyed with the
reason shown when you hover it; the control at the end of the row removes it. **Add Part** adds a
row at the end.

The **Preview** row is rendered by the same machinery that draws real numbers, against a sample
matter whose values are printed under it, so what you see is what a matter will get. **Save Scheme**
replaces the firm's scheme in one audited step; **Discard** returns the parts to the scheme in
force.

**A number already drawn is frozen.** Saving a scheme reaches only the matters numbered from then
on. Nothing already numbered is renumbered, and nothing here changes a single matter's number.

## Setting one matter's number by hand

A court's number, a number from the firm's previous system, or a correction is set on the matter
itself: open the matter, press its status badge, and under **Number** press **Set Number** (or
**Change Number** where one is already recorded). The number has to be unique in the firm and able
to stand in a link. It touches no counter, so the next matter opened still draws the next number in
the run, and the number it replaces stays on the record so a filing that quoted it still resolves.

The control is offered only on a matter that has been active. An intake or a consultation cannot be
given a matter number by hand any more than by the counter: no matter number exists before a matter
is active.

## Who can change it

Reading and changing the schemes needs the `matters:manageNumbering` permission. Setting a matter's
number by hand needs `matters:renumber`. Both are granted to the Owner/Admin role.
