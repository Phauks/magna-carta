---
category: Fixed
audience: public
---

**The calendar no longer waits for every matter the firm has ever opened before it paints.**

`calendar-context.svelte.ts`'s `ready` included `firmMatters`, and `calendar-controller.svelte.ts` refuses to issue the calendar's own reads until `contextReady()`. `FirmMatters` walks the whole matter listing — up to ten pages, and `listEveryMatter` issues two requests per page because the numbered and consultation streams are separate — one page after another, because each needs the previous cursor. So up to twenty requests across ten serial round trips completed before the grid's rows were even requested. Time to first paint scaled with how many matters the firm had ever opened, which is the wrong thing for it to scale with and gets worse every year a firm uses the product.

**What that walk contributes to the grid is a matter NUMBER on a chip** — the one thing on a chip that does not come back with its own row. Everything else a chip says (its kind, its type's name, its hour, its tone) is in the entry's own read.

So `ready` now waits for exactly what a chip cannot be painted without: the event-type catalog and the firm's week start, two parallel reads of fixed size. The matters are still read, in parallel, off the critical path — and `numbered` in `calendar-entries.ts` fills the number in from the controller's existing `visibleEntries` derived when they arrive. **Nothing is read a second time**: the chips re-label from state that is already in the browser.

`detailIsMatterNumber` on `CalendarEntry` is what makes that safe. Without it a later pass cannot tell a detail that WANTED a number from one that was complete as it stood, and would overwrite "Hearing · Department 12" on a matter's own calendar — where every row shares the matter, so the number is the one fact worth saying nowhere. `numbered` returns the same object where nothing changed, so a grid never re-renders a row nothing happened to.

**One consequence had to be handled rather than accepted.** A record form can now open before the matters land, and `MatterPicker`'s empty state said "No matters were read, so there is nothing to file this on." — which would have been false for a second on a large firm. An empty list means two different things and they look identical from inside the picker, so the caller, which holds the read, now says which: `reading` renders "Reading the firm's matters" instead. It defaults false, because a caller handing over a list it already has is never in that state.

Unchanged: the walk itself, its bound, and the Time Sheet's use of it. A firm past the bound still gets a capped list — and a chip whose matter is beyond the cap simply keeps no number, which is what it did before.

## Public

**The calendar opens without waiting for your whole matter list.** It used to read every matter the firm had ever opened before it drew anything, so the longer a firm had been using the product the longer its calendar took to appear — even though the only thing that list was needed for was printing a matter number on each entry.

Now the calendar appears as soon as its own entries are ready. The matter numbers fill themselves in a moment later, without the calendar asking for anything twice.

**And if you open New Event straight away**, the matter list may still be arriving. The picker now says "Reading the firm's matters" while it is, instead of telling you there are none.
