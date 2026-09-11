---
slice: 6·7 — The Messaging screen's review round: plainer questions, a record that opens, and a call that belongs to no matter
group: phase-6
order: 7
research: n/a
spec: n/a
plan: n/a
built: done
ui: done
load-profile: n/a
tested: done
branch: claude/messaging-screen-improvements-b7hyj1
active-work:
next: reporting on what a firm's phone actually carries, which the set-aside reasons now make answerable; resolving an inbound number against the Directory automatically, which the contact field only does by hand; the messaging port and the Telnyx adapter, still gated on A2P 10DLC registration
link-spec: docs/specs/2026-09-07-call-and-text-log-design.md
link-plan:
adrs:
blocked-by:
---

The owner reviewed the deployed screen on 2026-09-08 and the round is their list, worked end to end. Most of it is vocabulary and layout, one item is a crash, and two are real capabilities the log did not have.

**The crash first, because it was not this screen's alone.** Pressing the matter field returned an error report: the picker's "no matches" line was a `Combobox.GroupHeading` with no `Group` above it, which throws when the listbox opens — invisible until somebody clicks a field whose list is empty or fully narrowed, which is exactly when that line renders. The same one-line defect had shipped in four pickers (matter, time zone, calendar participants, the time record window's documents) and all four are fixed. The design system had already written this down, in `undo-redo-controls.svelte`: "Both hand-built copies of this control shipped without it."

**Selects rendered the value the database stores.** The form opened reading `voice` and `outbound`, because bits resolves a select's label from its `items` list and neither select passed one — the labels appeared only after the listbox had been opened once. The same omission put raw channels in the matter Activity section's Type column.

**A call and a text are one record and now look like one.** Type and Direction rather than Kind and Which way; the date and the time as two fields rather than one combined control; and one **Description** for both, which is the message on a text and the member's account on a call. The columns behind them stay two — `body` is what was sent and `summary` is what somebody remembered, so a read never has to ask which it is holding — but nobody typing has to care. A note recorded beside a text under the old two-field form is carried through a correction untouched rather than silently dropped. **Picture** is gone as a kind: a picture is something a text carries, so `mms` reads as Text everywhere and states what it carries beside the row. The commit is Save, and the wordy "a call or a text needs the number at the other end" that stood in the action bar for the whole time somebody was filling the form is now "The number."

**The number carries its country.** A dial-code control beside the digits, grouping as they are typed in that country's own national form, and the international form stored — which makes storing E.164 honest for the first time. The server still refuses to canonicalize on its own, because that needs a country it has no way to know; the form knows, because somebody picked it. All of it reuses `$lib/directory/phone-entry.ts` rather than re-deriving a country's grouping rules. Display reformats only what is already canonical: handing a free-text number to a parser that assumes a country turns "ext 4102" into "4102".

**A row opens into the record window, and a member-produced record is correctable there** (`communications.update`; a carrier row is refused, because editing one would turn an observation into a recollection wearing an observation's badge). The window's fields ARE the entry form's, rendered by one component, so the two cannot drift. Where the record belongs stays out of those fields and lives in the action bar, because a matter and a set-aside reason each move the row between queues through their own concurrency-safe act — folding them into the field patch was built first and discarded, since it turned one Save into three writes with a partial-failure state to explain.

**A call that belongs to no matter can finally be put somewhere.** `communication.disposition` — spam, firm business, nothing came of it — is the other anchor, and the unrouted queue is redefined as rows carrying neither, so it is a list that can be emptied. Nothing is deleted and nothing leaves the record; a set-aside row goes back to the queue on request, and filing one clears its reason in the same statement. The vocabulary is enforced in the domain package rather than as a CHECK, because the column lands on a populated table and SQLite cannot add a CHECK to one without the rebuild expand-contract forbids.

**Two smaller things the list asked for.** An **intake** starts from a call's own record, seeded with the caller and filing the call onto the matter it opens — the matters subsystem's own window, given a prefill, rather than this screen learning to open a matter. And the search now matches the matter's title and both its numbers as well as the words and the number dialled, because "what did we say on the Herrera file" is the question people actually bring.

The screen moved from `/communications` to `/messaging`; the sidebar id stays `communications`, because a member's stars are stored under it. 84 tests: 45 in the package, 18 over the routes, 21 over the form's model.
