---
category: Added
audience: public
---

**A Select list longer than seven options narrows as it is typed into.** `Select.Root` counts its `items`; past seven, the Trigger collects what is typed while the list is open (letters, digits, spaces, Backspace) into a query held in `select-search.svelte.ts`, rows whose label does not contain it (case and accents folded) leave the list, the first remaining row is highlighted for Enter, and Escape clears the query before closing. The panel shows the query in a search row and says "No matches" when nothing is left. Shorter lists keep jump-to-letter.

## Public

**Long dropdowns can be searched.** When a dropdown has more than seven choices, open it and start typing: the list keeps only the choices that contain what you typed, anywhere in the name, and Enter picks the top one. Backspace widens the list again, and Escape clears your search.
