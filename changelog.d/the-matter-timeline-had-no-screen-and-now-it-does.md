---
category: Added
audience: public
---

The matter's Activity section: fifteen subsystems' worth of history, in order, on one screen, each row named by the subsystem that owns it.

The federated timeline has been built, tested and served since the calendar slice — `GET /api/v1/matters/{matterId}/timeline`, fifteen declared sources read in place under one sort key, one cursor and one visibility contract, with nothing projected or copied. **Nothing in the web app called it.** The matter's story was scattered across the sections that each hold a piece of it, and the read that puts it back together answered to no screen.

**A consolidation view cannot know what its rows are, so it does not try.** Only the file manager knows what a file is; only the calendar knows what a hearing is called. The Activity section names no source and switches on none. Each subsystem declares its own half on both tiers:

- On the server, every timeline source now declares the read capability a description of its rows sits behind (`permission`), and a source whose rows have names declares a `describe` — one statement through `describeSelect`, which binds the matter, the page's row ids, the visibility predicate and the LIMIT, projecting a title, the subsystem's own word for what the row is, and that subsystem's own facts as one JSON object. The matter-scoped route asks for it after the merge, at most one statement per source present on the page, so the cost scales with the registry and never with the rows. The firm-wide read is never described, and a test asserts it: the no-label discipline on the projection is unchanged.
- On the client, an `ActivityContribution` per source lives beside the owning subsystem's own code (`$lib/file-manager/activity-contribution.ts`, `$lib/time/activity-contribution.ts`, and so on) and is registered once in `$lib/activity/contributions.ts`: the section word, the noun, the sentence for an undescribed row, the glyph, the Type word and the facts read out of the description in that subsystem's own vocabulary, how a row opens, and how one is made. `apps/web/test/activity-contributions.test.ts` scans the calendar package's own declarations and fails until every source has one; `pnpm run lint:matter-timeline-coverage` fails until every source is owned by a matter section's new `timelineSources` or declared ownerless in `sections.ts` with a reason.

**The permission gates the words, never the row.** A member who may not read notes still sees that a note was written on the matter, when and by whom — the entry carries no content — and does not see what it said. Six sources describe their rows today: a document by its name with its size, version and safety standing; a note by its opening line with when it happened and how many documents it points at; a time entry by its narrative with the hours; a cost by its description with the amount; an event by its title with its time and place; a deadline by its title with whether it is overdue, computed where the reader is. The rest keep the platform's own sentence, and adding one is a describe on the source and a contribution beside the subsystem.

**A file's type is what the file manager says it is.** The first cut took a name suffix for that. The new `$lib/file-manager/file-identity.ts` is the one place a file becomes words — the document type where the firm set one, else the label of the identification the design-system FileIcon resolves from the content type and the name ("PDF document", "Archive"), its size, and its safety standing out of the status register — and the Activity section draws the file manager's own glyph over the same inputs. Section and Type are two columns with two set filters: which part of the matter a row belongs to, and what it is in its own subsystem's words; one column doing both jobs had mixed "Deadline" with "pdf" in one list.

**It is the product's table, and its column controls are the column's own.** `DataTable.Grid` with Date (anchored), Time, Section, Type, Name, Details and Who; right-clicking a column heading opens the shared head menu for that column's filter, hide, pin and the roster of columns. There is no filter bar and no Columns button.

**It can make a record.** "+ New Note" opens the note window on the Activity section — the same window the Notes section opens, hosted by the new `NoteWindowHost` so the section knows nothing about notes beyond the fact that they have a window — and the row appears when it saves. A subsystem with a window of its own adds a create verb to its contribution and the control grows into a menu.

**Nothing says a document was "filed".** To a lawyer, filing means filing with a court, and this platform files nothing with a court: a document is added to the matter, an email is saved to it. The source keys stay `documentFiled` and `emailFiled` because they are wire contracts — which is exactly why the words a person reads are decided in the contributions and not taken from them.

Three deep links were repaired on the way. `emailFiled` pointed at a matter section spelled `email` and the three custody sources at `custody`; the app routes `emails` and `custodian`. A conflicts check has no matter section at all, so its rows state what happened and offer nowhere to go — the section registry says why, and the coverage lint keeps the answer current.

## Public

**See everything that has happened on a case, in one place.** The matter's new Activity section is the whole story in date order: email saved to the matter, documents added and assembled, hearings and deadlines, time and costs booked, client money moved, items in your custody, conflicts checks, the notes your firm wrote, and the day the matter opened. It is the screen to open when you pick up a file you have not touched in months, and the one to read from when you need to account for what was done and when.

**Every row says what the thing is, in its own words.** A document gives you its name, what kind of document it is, its size, its version and whether the scanner has held it back. A note gives you its opening line and when the thing it describes happened. Time gives you the narrative and the hours; a cost its description and amount; a hearing its title, time and place; a deadline its title and whether it is overdue. You read the case down the page without opening anything, and what you may not read on the matter is left out rather than hidden behind a vaguer word.

**Find it, then open it.** Sort by any column, right-click a column heading to filter it, hide it, pin it or bring another back, and the footer tells you how many rows a filter is hiding. Narrowing to one part of the matter is the Section filter; narrowing to one kind of thing is the Type filter; narrowing to one person is Who. Each row opens the thing it describes, in the section that holds it.

**Write a note from here.** "+ New Note" opens the same window the Notes section uses, and the note takes its place in the chronology the moment it is saved.
