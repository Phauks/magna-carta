---
category: Changed
audience: public
---

**The messaging form's second review round: two columns, every closed choice a combobox, one phone field shared with the Directory, and a start and end time the duration is worked out from.**

`communication-fields.svelte` is laid out as the measurable beside the written — type, direction, contact, number, the three time fields and where it belongs on the left; the description on the right, where the transcript and the recording tabs will go once the carrier is connected. The split is a container query on the fields themselves, so the record window's narrower pane stacks them without a second layout. Switching between Call and Text moves nothing: a text's end and duration stand refused rather than disappearing.

`$lib/components/choice-picker.svelte` is the one field for a closed set — a Combobox over `ChoiceOption`s with per-option search words, so a country answers to "44", "+44", "GB" and "United Kingdom" alike. Type, direction and the country are on it. `$lib/directory/phone-number-field.svelte` is the country and the digits as ONE field, used by the call log and by the Directory's contact rows, which had each built the pair by hand.

`formatPhoneAfterEdit` fixes the defect that made a number unshortenable: backspace over a grouping character deleted a character `AsYouType` put straight back, so the key did nothing. A deletion that removes no digit now removes the last digit instead. `phoneNumberPlaceholder` derives a country's grouping from libphonenumber's own example number (4 KB of `examples.mobile.json`), which is the one placeholder in the product that is not its field's name.

Country flags are vendored SVGs under `apps/web/static/flags` (country-flag-icons, MIT) served as static assets, never the flag characters: those are emoji (golden rule 2) and Windows has no font for them. A test asserts a file exists for every country the picker offers.

The duration is derived rather than typed. `LogDraft` still stores `durationMinutes` — the record stores a length, and keeping it as the draft's own field is what makes a correction round-trip without recomputing through a clock — and `draftEndTime` / `durationFromEnd` are the bridge to the two clock fields. An end before the start is a call that ran past midnight.

`MatterPicker` gains `extraChoices` / `extraHeading` / `extraValue`, so "Belongs to" is one searchable field carrying every answer the question has: a matter, a reason there is no matter, or the queue. `EntityPicker` gains `createBeside={false}` and `Textarea` gains `resizable={false}`; both default to what every other surface already does.

## Public

**The panel is called Record Communication**, whichever kind you are recording. It used to rename itself the moment you switched between a call and a text, and the line under the heading explained the subsystem to somebody who had already decided to write a call down.

**It is two columns.** The facts of the call are on the left — what it was, who it was with, which number, when, how long, where it belongs — and what was said fills the right. Switching between a call and a text no longer moves anything on the form.

**Every list can be typed into.** Type, direction, the country beside the number, and where it belongs: start typing and the list narrows. The country list carries flags, and answers to the dial code, the country's name or its two letters.

**A number can be shortened.** Backspacing through the brackets and spaces used to do nothing at all, so the only way to correct a number was to clear the field and type it again. The field also shows the shape the country writes — `(XXX) XXX-XXXX` here, and its own grouping anywhere else.

**A call has a start and an end, and the duration works itself out.** Give the two times and the length follows; a call that ran past midnight is five minutes, not twenty-three hours. Length in minutes as a field you typed into is gone.

**Where it belongs is one field.** Type a matter's name or its number, or pick a reason it is on no matter, or leave it for somebody to decide later — all in the same list. You no longer choose a category first and then a matter.

**The number and its country are entered the same way everywhere** — the field the call log uses is the field a contact's telephone number uses.

**Two smaller things.** The description no longer carries a drag corner that only pushed the panel's own footer around, and the New button beside the contact field is gone: a contact you cannot find is still added from inside the list, which is where people were adding them anyway.
