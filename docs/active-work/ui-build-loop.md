# claude/ui-build-loop — the feedback loop under UI work

**Scope.** Tooling and standards that let UI work be verified instead of asserted. No application
code, no screens. Owner-directed (2026-08-19) after the question "what is the best way to make UI
here, and should we use a different tool".

## What this stream adds

- `.mcp.json` — the Chrome DevTools MCP server. `docs/conventions/ui-design.md` has always required
  the coordinator to verify empirically ("screenshots, computed styles, interaction round-trips")
  and no browser tool was ever configured, so that requirement has never been satisfiable.
- `.claude/agents/ui-builder.md`, `.claude/agents/design-reviewer.md` — the standard already
  mandates delegating UI work to subagents with the constraints attached; there were no agent
  definitions, so every delegation restated the rules by hand and drifted.
- `docs/conventions/design-corrections.md` — the owner's standing rulings, seeded from the auth
  flow's fifteen mockup revisions. Most of what those revisions decided was general (title case,
  no em dashes in user-facing copy, durations from configuration, the back and resend patterns) and
  it lived only in a task description, so the next screen would have re-earned all of it.

## Files this stream owns

- `.mcp.json`
- `.claude/agents/`
- `docs/conventions/design-corrections.md`
- `docs/conventions/ui-design.md` (scope line, working model, new browser-verification section)
- `CLAUDE.md` (one orientation row)

## Found and not fixed here

**The visual-regression harness has never produced a baseline, and nothing is scheduled to.** There
is no `visual-regression/baselines/` directory, zero committed images, and no workflow in
`.github/workflows/` runs the suite. The harness README says the first authoritative baselines land
via a CI container job; that job does not exist in any workflow. The suite therefore skips on every
run and has since it was written. Generating them requires the pinned Playwright container
(`mcr.microsoft.com/playwright:v1.60.0-noble`); Docker's daemon is not running in the remote
environment, so baselines cannot be produced from here without poisoning the suite with a different
rendering environment. Tracked separately; not attempted.
