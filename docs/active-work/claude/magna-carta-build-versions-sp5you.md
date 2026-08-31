---
worktree: C:/dev/magna-carta-worktrees/claude/magna-carta-build-versions-sp5you
area: Build Versions panel — the owner's 2026-08-31 rulings against the version overlay
status: review
touches: apps/web/src/lib/versions, apps/web/test/version-overlay.test.ts, docs/conventions/design-corrections.md, docs/user/features/seeing-what-version-you-are-on.md
---

Five corrections to the version chip's overlay: the duplicate "This page" row demoted to a fallback,
the services-checked line moved under the header, Reload seated beside Refresh as a symbol, the
fleet list folded behind a remembered caret, and the copy confirmation changed from a check glyph to
a one-second fill. Confined to `apps/web/src/lib/versions/` plus its test; the only cross-cutting
file is `docs/conventions/design-corrections.md`, where the rulings are appended (new bullets at the
end of _Controls and patterns_ and a new dated round above the WHOIS entry — an append, so a
concurrent stream editing other sections will not collide).
