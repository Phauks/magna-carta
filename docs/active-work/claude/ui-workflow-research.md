---
branch: claude/ui-workflow-research
worktree: .claude/worktrees/ui-workflow
area: Research — what software and workflow the sign-in UI (and UI work generally) should use to get from mockup to shipped screen
status: review
touches: docs/research/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Research only — no product code, no config, no dependency added. Answers the owner's question about UI development workflow: component workbench, design-to-code path, preview and review loop, visual regression under a zero-CI budget, accessibility automation, and the least-waste path from the 27-version standalone sign-in artifact to the real Svelte screen. Documents only: one research document, one pending decision fragment, one changelog fragment, this note. Nothing under `packages/design-system/`, `apps/web/`, `docs/conventions/`, or any workflow/wrangler config is touched, so this stream cannot collide with a UI build stream — a stream that acts on the recommendations will edit those files, and should read this first.
