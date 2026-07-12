---
category: Fixed
---

**Navigating no longer keeps the previous page's scroll position.** The app shell's chrome (top
bar and sidebar) is fixed and only the work canvas scrolls, so the window never moves — and
SvelteKit's built-in scroll restoration scrolls the window, leaving the canvas stuck at wherever the
last page had it (land on a tool already scrolled hundreds of pixels past its masthead). The shell
now manages the canvas directly: a forward navigation (a link click or `goto`) starts the new page
at its top, back/forward restores where the reader had scrolled that entry, and an in-page hash
anchor still wins. The reset is instant, never a smooth scroll.
