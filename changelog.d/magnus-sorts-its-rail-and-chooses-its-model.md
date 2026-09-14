---
category: Added
audience: public
---

**Magnus sorts its rail, keeps a conversation on a matter, attaches a matter's files, and the firm
chooses its model.** The conversation listing (`GET /api/v1/magnus/conversations`) takes a `sort`
of `date`, `name` or `matter`, honoured over the whole record with a cursor that pages within that
order; the rail carries the control in its empty state too. A conversation is renamed where its
name is read (Enter commits, Escape cancels, blur commits; a refused rename keeps the old name and
says so). `PATCH .../conversations/{id}/matter` keeps a conversation on another matter or on none,
refusing a closed matter and auditing both matters, because which matter a transcript is kept on
decides who may read it. `POST .../conversations/{id}/attachments` attaches one of the matter's
files BY REFERENCE (`magnus_conversation_attachment`, a new per-firm table); on each later question
the file's current version is read, its text taken through the platform's own extraction port, and
sent ahead of the question under a heading naming the file within a 64 KiB budget, and the row
records whether the model saw it whole, cut, or not at all. Nothing of a file is copied. The
disclosure moved to version 2 (what Magnus can see changed), so every member is re-prompted.
Settings · AI and the Assistant gains the model control: `inference.primaryReasoningModel` is
chosen from the catalog's verified reasoning entries through the product's combobox, or returned to
"the platform's current model" (which DELETES the firm's row rather than pinning today's default);
the page states each entry's retention posture and verification dates and the catalog's version and
effective date. `magnus-surface.svelte` is split into the rail, the transcript and the composer, and
the composer names the model that answers.

## Public

**Magnus is easier to keep in order, and can read the files you hand it.** The list of your
conversations sorts by date, by name, or by the matter each is kept on. Rename a conversation by
clicking its name. Keep a conversation on a matter after the fact, or take it off one: the
confirmation says who can read it afterwards. Attach a matter's files to a conversation and Magnus
reads their text with your next question; beside each file the conversation says whether Magnus saw
it whole, saw part of it, or could not read it. Because Magnus can now see more than what you type,
you will be asked to accept the updated disclosure once. Firm administrators can now choose which
verified model answers, on the AI settings page, or leave the firm following the platform's current
model.
