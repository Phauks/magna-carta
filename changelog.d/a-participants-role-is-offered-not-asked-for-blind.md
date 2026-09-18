---
category: Changed
audience: public
---

**The event participant's role is the product's dropdown-with-add instead of a bare text box.** `apps/web/src/lib/calendar/participant-role-field.svelte` offers `PARTICIPANT_ROLE_OPTIONS` (eighteen roles, alphabetical, in `calendar-vocabulary.ts`) and ends the list in `Combobox.AddOption`, so a role the list has never heard of is still typed and kept — the column stays free text, which the per-firm schema rules deliberately because the vocabulary is jurisdiction-specific and nothing downstream reads it.

The standing rule under _Data entry_ in `docs/conventions/design-corrections.md` already decided the control ("a vocabulary that is not closed but is not free either is the product's dropdown-with-add … the same control in every such field"); the location field on the same form and the matter-party role already had it, and this field was the one that had not been carried over. A closed dropdown was considered and rejected: the roles a practice needs do not close, and a fixed list missing one makes somebody pick a wrong-but-adjacent role, which corrupts the consistency the list existed for and does it invisibly.

`settledParticipantRole` collapses a typed role onto an offered spelling in any casing, so "court reporter" no longer founds a second role beside "Court reporter"; anything unlisted is kept exactly as typed, trimmed. The field's name stays "Role" rather than the clearer "Attending as" because `AddOption` reads the name into a row that says `Add <name>`. Pinned by `apps/web/test/calendar-participant-roles.test.ts`.

## Public

**Saying what someone is at a hearing no longer means guessing what to type.** The role beside each person on an event now offers the roles that actually come up — appearing counsel, judge, court reporter, interpreter, expert witness and more — while still letting you type anything your practice needs.

**The same role is now spelled the same way every time.** Typing "court reporter" where "Court reporter" is already offered records the offered spelling, so one role stops turning into three and narrowing a list by role finds all of it.
