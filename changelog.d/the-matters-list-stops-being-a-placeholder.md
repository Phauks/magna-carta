---
category: Added
audience: public
---

**The matters list is a real docket, and a matter can be opened from it.** The screen was a hardcoded
empty state with a permanently disabled "New matter" button — no query, no rows, and a `disabled`
attribute written into the markup rather than derived from anything. The backend it was standing in
front of had been complete for months: create, cursor-paginated list, get, patch, and the whole
open/close/reopen/renumber lifecycle. Nothing was missing except the screen.

It now reads the firm's own matters through the listing and renders them on `DataTable.Grid`, the
platform's one table, so the docket inherits the settled machinery rather than reimplementing it:
type-aware sorting, the one-mechanism per-column filters, column show/hide, drag-reorder, pinning,
resize, and the counts footer. Columns are matter number, title, client, status, practice area,
Location (hidden until a firm asks for it) and created date. A scope control selects what the
listing is asked for, and the search box runs the server's own search over title, number and client
rather than narrowing the rows already on screen.

**"New matter" opens a real matter.** The dialog carries the contract's required set and nothing
invented: a title, whether the file starts as an opened matter or an unnumbered consultation, the
client, and the firm's own practice-area and Location vocabularies. The number is deliberately not a
field — it is drawn by the firm's counter at the moment the matter opens, atomically, and a field
for it would be a field for breaking that. Every submit carries an idempotency key, so a retry
cannot open a second matter.

Three gaps are on the screen rather than hidden, because a docket that quietly cannot answer a
question is worse than one that says so:

- **The responsible attorney is not a column.** The listing answers an identifier for it and nothing
  on the server publishes the firm's members, so naming them would cost one request per row and
  printing the handle would be printing a handle at a person. The dialog's own responsible-attorney
  field renders for real, showing the person creating the matter, disabled and marked "Soon" with
  the dependency named.
- **The date column says "Created", not "Opened".** The listing serves the creation instant; a
  matter opened months after the consultation that started it has two dates and only the detail read
  carries the second.
- **Sorting and the column filters cover what has been loaded.** The listing is cursor-paged, so the
  footer counts the page rather than the firm until the record is fully read, and the line under
  "Load more" says exactly that.

A refused open now says where to fix it: opening a numbered matter needs the firm's numbering
scheme, and the refusal points at the settings page that configures one instead of leaving the
server's one-line reason to be interpreted.

The matter status register — prospective, open, closed, with their labels and their subtle badge
tones — moved out of the matter header into one shared module both surfaces read, so the header's
seal and the docket's status column cannot drift apart. Closed stays quiet neutral: a closed matter
is archived-but-additive, not a failure.

## Public

**Matters is now your firm's docket, and you can open a matter from it.** The screen used to say
"No matters yet" whatever your firm held, and the "New matter" button never worked. It now lists
every matter the firm has, in a table you can sort, filter by any column, search, and rearrange to
suit how you read a caseload. Press a matter's title to open it, or hold Ctrl (Cmd on a Mac) to open
it in a second tab.

**Showing** switches between the working docket, open matters, closed matters, and consultations.
Consultations sit apart on purpose: a file the firm has not taken on yet carries no matter number,
and counting it in the live caseload would overstate the firm's work.

**New matter** opens a real one. Give it a title and choose whether it opens straight away, drawing
the firm's next matter number, or is recorded as an unnumbered consultation while the firm decides.
The client, the practice area and the office are all optional and can be filled in later from the
matter itself. Matter numbers are issued by your firm's own numbering scheme and are never typed by
hand, so two people opening a matter at the same moment can never be given the same number.

Two things the screen does not do yet, and says so rather than pretending otherwise: it cannot show
which attorney is responsible for each matter, and a new matter always opens under the person
creating it. Both wait on the firm member directory. If opening a matter is refused because your
firm has not set up a numbering scheme, the message now points at the settings page that does it.
