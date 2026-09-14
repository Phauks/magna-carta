---
category: Changed
audience: public
---

**Every shipped Workspace screen searches itself through `ScreenSearch`, in the screen header's `actions` snippet, or records why it does not.** The Matters docket, the Directory and a matter's Notes each carried their own search — a `type="search"` field beside a Lucide search glyph, its own debounce, its own toggle behaviour on a live query — so both 2026-09-02 corrections against the shared control (the clear glyph, collapse-on-click-away) had reached the component and none of the three. All three now use the control. Downloads and Uploads gained one; both hold their whole list in the browser, so they narrow on `searchOn="keystroke"` with nothing leaving the machine.

**Four screens gained a search by gaining a query on their read**, which is where the work was. Notifications, the Conflicts Check log, Magnus and the Calendar were first recorded as declining on the grounds that their reads took no search parameter; that is a reason to add one.

- **Magnus** matches the conversation title and what was SAID in it — nothing generates a title, so a transcript search is the only way a conversation is found again. Content is in scope only for a member's OWN conversations; the firm-wide administrative read matches titles alone, because `packages/magnus/CLAUDE.md` holds that transcripts may not be swept across the firm's records until the discovery surface owns an include-or-exclude control for it. `searchesContent` is the one place that boundary is decided.
- **Conflicts Check** matches the matter a run was made against and the NAMES it surfaced, through `directory_name.normalized_display` so a term normalizes the way the corpus did. The closed labels stay with the column filters, which match them exactly. "Has this firm ever checked this person" is now one question rather than a walk through the log.
- **Notifications** carries no sentence in the record by design, so the client resolves the term into the kinds and categories whose WORDS match (`kindsMatching` / `categoriesMatching`) and sends those with it; the server OR-s them against the matter number. An empty `kinds` means the term matched no kind, never "match no row". The unread badge is deliberately not narrowed.
- **The Calendar** narrows the window on screen, because its three reads cap their horizon server-side and refuse a wider one rather than clamping it. The view states how many entries in the named window match and that other dates were not searched, so the control never implies a reach it does not have.

`@magna-carta/data-access/like-search` is the new one home for escaping a reader's text into a `LIKE` pattern. Two copies of that rule already existed (the discovery review reads and the communications log), agreeing by luck; a third was about to be written here. A test caught the bug that makes it worth having: `normalizeName("%")` strips to the empty string, and a contains-pattern built from an empty term is `%%`, which every stored name matches — a reader typing one stray character would have been handed the whole conflicts log.

`pnpm run lint:workspace-search` is the new fitness function. It reads the Workspace group out of `navigation/destinations.ts` and the pages out of the route tree — no roster kept by hand — and refuses four things: a Workspace screen that neither searches nor declines, a control seated outside the header's action row, a decline left standing after its screen got a search, and a second implementation of a search box anywhere beneath a Workspace destination. Coverage follows the render rather than the file, walking each page's `$lib` component imports, so Tasks passes on the search `TaskList` owns. Thirteen of the fourteen shipped Workspace screens now search; Home declines, being a summary of other screens rather than a list.

## Public

**Every screen under Workspace searches itself the same way: one control, in the top right of the title row, resting as an icon until you press it.**

Matters, the Directory and a matter's Notes each had their own search box before this. They looked close enough to pass, and they were not the same — each had its own idea of what pressing the icon on a live query should do, and two improvements made to the shared control in September had reached none of the three. All three now use the one control, so the next improvement reaches them with everyone else.

Six screens gained a search they did not have:

- **Downloads** and **Uploads** narrow as you type; both already hold everything they list.
- **Magnus** finds a conversation by what you asked in it, not just by a title you probably never gave it.
- **Conflicts Check** finds a run by the matter it was made against or by a name it surfaced — so "has this firm ever checked this person" is one search rather than an afternoon.
- **Notifications** searches your whole feed, not just the part already on screen.
- **The Calendar** narrows the dates you are looking at, and says so: it tells you how many entries in that month or week match, and that other dates were not searched, so you know to move the calendar rather than assume there is nothing there.

Home has no search, and is the one screen that does not: it is a summary of your other screens, and the way to search from it is the search box in the top bar, which goes anywhere in the app.
