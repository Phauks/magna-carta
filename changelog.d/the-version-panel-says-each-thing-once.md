---
category: Changed
audience: public
---

**The Build Versions panel stopped saying the same thing twice, and its two gestures moved into one cluster.** Five owner rulings from a deployed-site walk, recorded in [`docs/conventions/design-corrections.md`](../docs/conventions/design-corrections.md):

- The standing **"This page / committed … · built …"** row duplicated `magna-carta-web`. That Worker serves the interface, so its commit and timestamps already are this page's, said once under a name someone can open in a dashboard. `showsPageBuildRow` in `apps/web/src/lib/versions/version-overlay-model.ts` keeps the line as a fallback rather than deleting it outright: signed out, a read that failed, or a web row that came back silent all leave nothing else able to state this build, and a panel reporting no version at all is the opposite of the point. While a first read is still in flight it stays away, so it cannot appear for a moment and then vanish when the answer lands.
- **"Services checked … ago"** sits under the header instead of beside the controls. Its length changes on a clock, and on the header row that motion pushed the Refresh button around while a reader was aiming at it.
- **Reload** is now a warning-tinted `rotate-cw` symbol beside Refresh, appearing only while the version poll has a newer bundle in hand. It reads as the answer to the chip's dot rather than as a second refresh, and the Update Available block keeps the badge and the sentence without a second copy of the gesture.
- The **Workers** beneath the leading pair fold behind a caret, remembered per browser on the shared persisted-preference primitive (`version-panel-preferences.svelte.ts`). It defaults to open, and a shut heading counts the Workers that came back without a version, so folding hides rows and never hides a fault: the fleet list is exhaustive precisely because an omission reads as health.
- **Copying a version** darkens the control for a second instead of growing a check beside the commit. The glyph widened the button on every press, and the width change read as the identifier itself changing.

## Public

**The version overlay is shorter, and its controls sit together.** The panel used to open with a "This page" line that repeated what `magna-carta-web` was already reporting a row below; that line now appears only when nothing else can answer — before you sign in, when the read fails, or when that worker itself is silent.

The rest of the fleet folds away behind a caret beside **Workers**, and the overlay remembers whether you left it open or shut. If any of the folded workers came back without a version, the shut heading says how many, so folding the list can never hide a fault.

When a newer version has shipped, an amber reload symbol appears at the top of the overlay next to the refresh control, and the line telling you how fresh the reading is has moved under the heading so it no longer nudges the buttons as the clock ticks. Clicking a version to copy it now darkens it for a moment instead of growing a tick beside it.
