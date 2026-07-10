# dev-build-stamp-overlay

**Scope:** A dev-only build-stamp overlay — a floating badge (live clock + this build's commit / mode /
build time), draggable/keyboard-movable between the four screen corners, toggled by a new
Settings · Developer flag. Branched from `slice-0-7b-app-shell` (which owns the app shell); merges back
there.

## Files touched

- `apps/web/src/lib/developer/build-stamp-overlay.svelte` — new: the overlay component (drag +
  corner-snap + keyboard, live clock, build identity).
- `apps/web/src/lib/settings/developer-preferences.svelte.ts` — new subordinate flag
  `buildStampOverlayVisible` on the master cascade.
- `apps/web/src/routes/(app)/settings/developer/+page.svelte` — the toggle row under Toolkit Controls.
- `apps/web/src/lib/components/app-shell.svelte` — DEV-gated dynamic-import mount (one branch, sibling
  to the developer-console mount).
- `changelog.d/build-stamp-overlay.md` — fragment.

Reuses the existing seams: `BUILD_IDENTITY` (build-identity.ts) for the commit/mode/build time, and
`createDeveloperConsoleStorage` for the persisted corner.
