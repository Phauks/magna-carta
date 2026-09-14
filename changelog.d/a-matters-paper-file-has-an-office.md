---
category: Added
audience: public
---

**The matter's paper file is kept at one of the firm's offices, and the status window states which.**
`matter.physical_file_location_id` is a new nullable per-firm column pointing at `location`, set
through `PATCH /api/v1/matters/{id}` (`matters:edit`) and answered by the matter detail read as
`physicalFileLocationId` plus a resolved `physicalFileLocationName` — `selectMatterDetailStatement`
now joins `location` twice under two aliases, because a matter names two different offices.

It is deliberately not `matter.location_id`. That column says which office RUNS the matter and is the
citation on the matter header; this one says where its folder is KEPT, and a folder travels. One word
("Location") on two screens was hiding two facts.

The status window's Physical File renders the row through `$lib/offices`' `OfficeLink` and sets it
through `OfficePicker`, reading the matter itself when the window opens so a file moved elsewhere
between two openings does not leave the window stating where it used to be. Held In and Destroy After
keep the Soon mark: what a folder sits inside is a record that does not exist yet, and there is no
retention clock anywhere to derive a destruction date from. `MATTER_PHYSICAL_FILE_FACTS` carries a
`served` flag so which rows are real is one list with one test.

The New Matter dialog's Location moved from `vocabulary-picker.svelte` to the same `OfficePicker`,
which reads the firm's offices through the shared store; the dialog's `locations` prop is accepted and
no longer read, and nothing imports `VocabularyPicker` now.

## Public

**You can record which office a matter's paper file is kept at, and open that office from the matter.**
Press the matter's status seal, choose Matter Status, and the Physical File panel's Location is now a
link to the office record: its address, its telephone, who works there. Press Set Location to record
it, or Change Location to move it — a file boxed at a records store is recorded where it actually is,
not where the matter is run out of. Leaving it empty is a real answer: a firm that does not know where
a folder is can say so rather than leave a guess on the record.

Held In and Destroy After are still marked Soon.
