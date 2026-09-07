---
category: Fixed
audience: public
---

**The `Tooltip.Provider` moved from the app shell to the root layout**, so every route group sits beneath it. The version chip reached the signed-out surfaces on 2026-09-02 and brought a tooltip with it; a `Tooltip.Root` with no Provider above it throws (`Context "Tooltip.Provider" not found`) rather than rendering bare, and the only Provider lived inside the app shell, which the sign-in, password-reset and joining screens never mount. Clearing cookies and reloading therefore crashed the sign-in screen before it drew. The shell's own Provider is gone (one, at the root, is the design system's stated placement), and `apps/web/test/root-layout-tooltip-provider.test.ts` pins that a bare tooltip throws and the same tooltip renders beneath the root layout.

## Public

**Signing in works again after clearing your browser's cookies.** The sign-in, password-reset and invitation screens had begun failing to draw, with an error in the browser console, because a control they share with the signed-in app was missing a piece of setup that only the signed-in app provided.
