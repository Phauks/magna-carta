---
category: Changed
audience: public
---

Matter notes: edit and delete replace correction-by-revision and withdrawal, a note records when the thing it describes happened, and a note can point at the matter's documents.

Three changes on the owner's direction, hours after the note primitive first shipped.

**The model collapses to one row.** The first cut held an identity row plus a chain of revisions, with three `RAISE(ABORT)` triggers making a stored body unrewritable and withdrawal as a state rather than a delete. An edit now overwrites and a delete removes the row. The owner's reason: replacing a note with another note every time somebody fixes a word accumulates without end. What it costs is stated rather than buried — there is no record of what a note said before, and nothing survives a deletion but an audit row carrying identifiers — and the superseded reasoning is kept in `docs/decisions/pending/` rather than deleted, because the position was really taken. The migration is a reviewed rebuild that carries every standing note across with its current text; `notes:retract` retires and deleting rides `notes:write`.

**A note carries two times and stops conflating them.** `created_at` is when somebody typed it; the new `occurred_on` / `occurred_at_time` / `time_zone` are when the thing it describes happened, on the calendar's model — a civil date, an optional wall clock, and a zone required whenever there is a clock. Every read orders by the occurrence falling back to the written day, and so does the federated timeline source, whose `timeColumnShape` moves from `instant` to `civilDate`. That puts a note about Tuesday's call beside Tuesday's hearing, which is how `matterEvent`, `matterDeadline` and `timeEntry` are already ordered; the one source that orders by when the row was written is the audit log, and that is named as its weakness rather than copied.

**A note can point at the matter's documents.** `matter_note_document` is a many-to-many link on the `matter_asset_document` model, and it links a handle rather than moving bytes: upload stays the File Manager's presigned-upload and quarantine chokepoint, so an attached document keeps its versions, its holds and its reachability from discovery. Deleting a note detaches its documents and deletes none of them. The merge-field fitness function now refuses the link table too, since a resolver reaching it would be one join from the bodies of every note discussing the document being assembled.

The composer shows every field the note will carry before anything is typed, generated ones included: the matter, the writer's name and the instant it will be stamped with.

## Public

**Notes now say when something happened, not just when you wrote it down.** A note typed on Thursday about a call on Tuesday can say Tuesday, and the matter's history puts it there, beside whatever else happened that day. Add a time if you know it. Notes that describe no single moment, like a standing instruction, simply leave the date empty.

**Edit and delete work the way you expect.** Editing a note replaces its text; deleting one removes it. Both are plain and immediate. Two things to know: an edit does not keep the previous wording, and a deleted note cannot be recovered by anyone, including your administrator.

**Attach the matter's documents to a note.** Point a note at the letter it discusses or the draft it reviews. The document is not copied or moved: it stays in the matter's files with everything that comes from being there, and one document can be attached to several notes. Deleting a note never deletes a document.

**The composer shows what it is about to store.** Before you type, you can see which matter the note lands on, whose name goes on it, and the moment it will be stamped with.
