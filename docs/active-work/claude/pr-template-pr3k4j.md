---
worktree: claude/pr-template-pr3k4j
area: repository governance — the pull request template
status: review
touches:
  - .github/pull_request_template.md
  - docs/conventions/documentation.md
---

# Pull request template

Adds `.github/pull_request_template.md`, so every pull request opens with the sections the conventions already ask for: what and why, the change type, what reaches production at merge, the documentation lanes with their fragment paths, the local `pnpm test` result the 2026-09-03 ruling requires in the description, and the golden rules a review most often catches late. No other file's content moves; the template links to the standards rather than restating them.
