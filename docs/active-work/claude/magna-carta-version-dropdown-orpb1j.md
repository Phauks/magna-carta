---
worktree: /home/user/magna-carta (remote session)
area: Build Versions panel, second round — a colour-coded API/web sync badge in place of the fixed topology sentence, and a reflow fix for the services-checked line
status: review
touches: apps/web/src/lib/versions, apps/web/test/version-overlay.test.ts, docs/conventions/design-corrections.md, docs/user/features/seeing-what-version-you-are-on.md, changelog.d/
---

Follow-up to the 2026-08-31 Build Versions panel round (`docs/active-work/claude/magna-carta-build-versions-sp5you.md`, since landed). Two owner-requested changes to the same panel: the fixed sentence explaining that `magna-carta-web` and `magna-carta` deploy separately is replaced by a colour-coded sync badge (`apiWebSyncState` in `version-overlay-model.ts`: in-sync/web-behind/mismatch), and the "Checking services" / "Services checked … ago" header line is now mounted unconditionally so the popover no longer resizes as a read moves from in-flight to answered to aged. Confined to `apps/web/src/lib/versions/` plus its test, with the same cross-cutting touches the first round made (`docs/conventions/design-corrections.md` append, `docs/user/features/seeing-what-version-you-are-on.md`).
