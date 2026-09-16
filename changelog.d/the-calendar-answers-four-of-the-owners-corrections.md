---
category: Changed
audience: internal
---

**Four corrections on the calendar surface, from the owner's 2026-09-14 round.**

**Whose calendar left the toolbar.** The Mine / Everyone pair and the colleague dropdown beside them are gone: "remove colleague, mine, everyone buttons since that is covered by leftside bar functionality". They were a second mechanism for a question the rail already answers a calendar at a time — a reader wanting their own day turns their own calendar on. The address's `scope=` key is still read, so a link somebody was handed still opens where it says, and `chooseScope` survives for the host whose scope changes under it.

**The event type is a typeahead, sorted.** It was a plain select over a catalog that runs to dozens of hearing, conference and deposition kinds, in whatever order the read handed them over. It is now the same combobox the zone field and the member pickers are, and the list is alphabetical.

**The record form's timing fields are two identical lines and one zone control.** Three defects in one region, all reported: the zone sat in a 40-pixel slot, so its list of continents and cities opened into a field too narrow to read; the Ends line stated the same zone as a *sentence* where Starts offered a dropdown; and both lines were built from fitted controls, so an empty time field and a filled one were different widths and the two lines drifted out of alignment the moment somebody answered one of them. Starts and Ends are now the design system's `FieldRow` — equal tracks, which cannot do that — and the zone is its own full-width control beneath the two moments it qualifies. `TimeZonePicker` lost its `compact` mode with the slot that needed it; the list still reads by code and name both, because CST is three different zones.

Still open from the same round, and larger than a screen: a separate zone for the end of a setting (one `time_zone` column today), events reaching the calendars of their location and their participants, participants editable in the entry window and addable by tag, one location model over offices, rooms, places in town and meeting links, and recurrence.
