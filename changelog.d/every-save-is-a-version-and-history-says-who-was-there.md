---
category: Added
audience: public
---

**Every save in the browser editor is a version, history folds the autosaves, and each version says who was in the document.**

A version was cut only when a session ended, and later only on the member's own save and the exit save; the editor's autosave every few minutes kept the working copy and nothing else. The owner's ruling is that the timeline of every state is the point, and that too many rows is a folding problem: every save with changed bytes is a version now, autosaves included, and the version carries what kind of save cut it (`save_kind`: the member's own, the autosave, the exit save, or the idle reap). History shows the named saves and folds the autosaves behind one line that says how many there are, opened with a click.

Each version cut from the working copy also records everyone with a view open at that moment (`file_version_participant`), so history reads "Ana · with Trevor, Mira" rather than the one name whose save happened to cut it. Names are read off the member roster when history is read, so a renamed member reads under their current name and a departed one keeps their identifier.

One per-firm migration: the column and the table. Design: `docs/specs/2026-09-17-document-history-and-attribution-design.md`, layers one and two.

## Public

Every save in the editor now appears in the document's history, with the autosaves folded away until you want them, and each version shows everyone who was editing at the time.
