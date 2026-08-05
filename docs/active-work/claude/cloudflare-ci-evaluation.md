---
branch: claude/cloudflare-ci-evaluation
worktree: .claude/worktrees/agent-aa18411bf77ccdd9a
area: Research — can the quality gate run on Cloudflare instead of GitHub Actions?
status: review
touches: docs/research/, changelog.d/
---

Research prompted by the owner's question during the CI-austerity window: the GitHub Actions minutes
hit their budget limit, so can CI run on Cloudflare instead? The answer is written up at
[`docs/research/2026-08-05-cloudflare-ci-evaluation.md`](../../research/2026-08-05-cloudflare-ci-evaluation.md)
— a per-job feasibility map of `.github/workflows/gate.yml` against Cloudflare Workers Builds, a cost
comparison at measured volumes, three labelled options, and the owner decision points.

**This stream is research only.** It writes one new file under `docs/research/` plus a changelog
fragment and this note. It changes no workflow, no convention, and no configuration, and it records
**no ADR** — nothing here is a decision. The binding decision in this area is ADR-0075 as amended (the
Workers Builds deploy model), and this document does not change it.

**What a concurrent stream should know:** it does not touch `.github/workflows/gate.yml`,
`docs/conventions/build-performance.md`, or `docs/conventions/operations.md` — all three are owned by
`claude/ci-austerity`, which is in review and is the stream that actually changed the CI cadence. This
document reads those files and links to them; if its recommendation is ever adopted, the edits belong
in that stream's homes, not here.

## Files expected to be touched

- `docs/research/2026-08-05-cloudflare-ci-evaluation.md` (new — the only substantive file)
- `changelog.d/cloudflare-ci-evaluation.md`
- this note

**Never edited:** `.github/workflows/gate.yml`, `docs/conventions/build-performance.md`,
`docs/conventions/operations.md`, `tooling/affected-lint/**`.

## Overlaps

- `claude/ci-austerity` — same subject matter, different artefacts. That stream owns the workflow and
  the conventions; this one owns the research write-up. No file is touched by both.
