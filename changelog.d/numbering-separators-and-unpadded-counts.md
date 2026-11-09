---
category: Changed
audience: public
---

**Client and matter numbering: separators, unpadded counts, and an editor that drags.** `NumberSegment`'s `date_opened` and `client_name` take an optional `separator` (`-`, `.`, `_`, `~` or empty; a slash is refused because a number is URL-safe), mirrored in the OpenAPI `NumberSegment` schema and the generated client. Absent renders as before (`20261111`, `AshcombeMercantile`), so no saved scheme changes shape; a client name's words are now folded one at a time and joined by the separator, dropping a word that folds to nothing. In `numbering-scheme-editor.svelte`, Preview sits under Current with no descriptive line under either (Current keeps its line only when nothing is in force), parts move by a grip on `DragReorderController` with Alt+Arrow as the keyboard path, the move buttons and the examples (`NUMBERING_STARTERS`) are gone, "Digits" is "Format" (counter minimum digits, year digits, separators), "Restarts the Count" is "Separate Count", the Part picker shows each kind's sample value, and a new counter starts at one digit. `compareGridRows` orders text with a numeric `Intl.Collator`, so every `DataTable.Grid` text column sorts `3333-2` before `3333-10`.

## Public

**Client codes can be numbers, and matter numbers need no padding.** A matter numbering scheme of Client Code, a dash and a Counter, with Separate Count on for the client code, gives client 3333's matters `3333-1`, `3333-2` and on through `3333-10`, while client 4444's start at `4444-1`. A new counter is written with no leading zeros; set its fewest digits to 4 if you want `0001`. Lists now sort numbers the way you read them, so `3333-2` comes before `3333-10` in every table.

**Choose how dates and client names are joined.** **Date Numbered** and **Client Name** now have a separator: Dash, Period, Underscore, Tilde or None, so a date can read `2026.11.11` and a name `Ashford-Holdings`. Schemes you have already saved keep the shape they have.

**The numbering editor is simpler.** **Preview** now sits directly under **Current**, so you can compare the two at a glance. Drag a part by its grip to move it, or focus the grip and press Alt with an arrow key. **Restarts the Count** is now **Separate Count**, the **Digits** column is now **Format**, the Part list shows what each part would put into the number, and **Add Part** is a quiet line under the last part. **Load an example** has been removed.
