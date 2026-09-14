---
category: Changed
audience: public
---

**Every shipped Workspace screen searches itself through `ScreenSearch`, in the screen header's `actions` snippet, or records why it does not.** The Matters docket, the Directory and a matter's Notes each carried their own search — a `type="search"` field beside a Lucide search glyph, its own debounce, its own toggle behaviour on a live query — so both 2026-09-02 corrections against the shared control (the clear glyph, collapse-on-click-away) had reached the component and none of the three. All three now use the control. Downloads and Uploads gained one; both hold their whole list in the browser, so they narrow on `searchOn="keystroke"` with nothing leaving the machine.

Five screens decline, each because its rows are paged off a read that takes no query: Home, Notifications, Conflicts Check, Magnus, Calendar. Each decline is recorded in `tooling/lint-workspace-search/workspace-search.mjs` with what it waits on, and printed on every run of the gate.

`pnpm run lint:workspace-search` is the new fitness function. It reads the Workspace group out of `navigation/destinations.ts` and the pages out of the route tree — no roster kept by hand — and refuses four things: a Workspace screen that neither searches nor declines, a control seated outside the header's action row, a decline left standing after its screen got a search, and a second implementation of a search box anywhere beneath a Workspace destination. Coverage follows the render rather than the file, walking each page's `$lib` component imports, so Tasks passes on the search `TaskList` owns. Membership in the repo-wide lint set is derived from the `lint:*` scripts, so it was in the inner loop and the gate of record the moment it was registered.

## Public

**Every screen under Workspace searches itself the same way: one control, in the top right of the title row, resting as an icon until you press it.**

Matters, the Directory and a matter's Notes each had their own search box before this. They looked close enough to pass, and they were not the same — each had its own idea of what pressing the icon on a live query should do, and two improvements made to the shared control in September had reached none of the three. All three now use the one control, so the next improvement reaches them with everyone else.

Downloads and Uploads gained a search they did not have. Both already hold everything they list, so the query runs as you type.

Five screens deliberately have no search yet: Home, Notifications, Conflicts Check, Magnus and Calendar. Each reads its rows a page at a time, and a search that only looked at the page in front of you would tell you nothing matched when your match was further down. Each is waiting on a real search rather than a convincing one.
