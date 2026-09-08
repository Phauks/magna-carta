---
category: Changed
audience: public
---

**The Messaging screen's review round: `/communications` → `/messaging`, one shared field layout for both types, a record window over the log, and a second anchor for a row that belongs to no matter.**

`communication.disposition` (`spam` | `firmBusiness` | `noAction`) is the other anchor. The unrouted queue is redefined as rows carrying neither it nor a matter, so it is a list somebody can empty; `scope=setAside` reads the rest, both behind `communications:reviewUnrouted`, and filing a set-aside row clears its reason in the same statement. The vocabulary is enforced in `packages/communications/src/validation.ts` rather than as a CHECK, because the column lands on a populated table and SQLite cannot add a CHECK to one without the rebuild `test/expand-contract.test.ts` forbids.

`communications.update` corrects a member-produced record; a carrier-produced one is refused, since `producer` exists precisely so a recollection and an observation are never confused. The correction resolves the whole row and re-validates it rather than emitting a partial SET, because the channel decides which content columns may be filled. Where a record belongs stays out of that patch and lives in the record window's action bar: a matter and a disposition each have their own concurrency-safe statement.

`communication-fields.svelte` renders the recording dialog and the record window's editing mode, so the two cannot drift. Both selects now pass `items` — bits resolves a label from that list, and without it a select renders the stored value until the listbox has been opened once, which is why the form opened reading `voice` and `outbound`. The same omission put raw channels in the matter Activity Type column. The number gains a country control reusing `$lib/directory/phone-entry.ts`, which makes storing E.164 honest for the first time: the server still refuses to canonicalize, because it has no way to know the country, and the form does. Display reformats only an already-canonical number — handing free text to a parser that assumes a country turns "ext 4102" into "4102".

The search now matches the joined matter's title and both its numbers; the visible-matter predicate is composed first, so a walled matter's title can never be matched.

## Public

**Messaging: a call or a text can be opened, corrected, and set aside as something that belongs to no matter.** The screen moved to `/messaging`, which is what the sidebar has always called it.

**The form asks plainer questions.** Type and Direction instead of Kind and Which way — and both now show their own words, since a select that had not been opened yet was rendering the value the database stores, so the form opened reading "voice" and "outbound". The date and the time are two fields rather than one combined control, because changing the day of a call recorded this morning should not mean stepping through a clock. What was said is the **description** on a call and on a text alike; the two used to be asked for under different names and laid out differently, and they now look the same, because they are the same record. The button says Save.

**A picture message is a text.** It was a third thing to choose between, which is one decision more than anybody makes: a picture is something a text carries. The record still knows the difference and says so beside the row.

**The number carries its country.** A dial-code control sits beside the digits, they group as you type in that country's own form, and the record stores the international number — so an area code lands where the eye expects it and a number reads back the way a phone would show it.

**You can say who you were talking to.** Picking a contact from the directory fills in their number, and a call that names a contact can start an **intake** for them without leaving the record: the matter opens with the caller already filled in, and the call is filed onto it.

**Not every call is a case.** Spam, a wrong number, the landlord, an enquiry that never came to anything: none of them can be filed onto a matter, and until now they sat in the queue forever. A record can be **set aside** with a reason — spam or wrong number, firm business, nothing came of it — which takes it out of the queue without pretending it was a matter. Nothing is deleted, and a firm that decides a written-off call was real work after all puts it back.

**A row opens.** Double-clicking one used to jump to its matter, or do nothing at all. It now opens the record: read it, correct it, print it, file it, set it aside, or start an intake from it. A record the carrier wrote is not editable, and says why.

**Searching the log** now matches the matter's name and number as well as the words and the number dialled.
