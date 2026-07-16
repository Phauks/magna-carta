# Maintenance Agents

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: maintenance-agents
  name: Maintenance agents
  scope: Scheduled propose-only Claude agents plus CI tooling (open PRs/reports, never auto-merge; trust/ledger/conflicts paths always human-reviewed).
  status: partial
  adrs: ADR-0016, ADR-0058
  evidence: Docs-maintenance system built on this branch; the other six agents have no artifacts.

- id: maintenance-agents.security
  name: Security agent
  scope: pnpm/cargo audit, CVE triage, secret scanning on a schedule.
  status: not-started
  evidence: No agent skill, workflow, or routine; dependency security batches land as manual branches.

- id: maintenance-agents.dependency-upgrade
  name: Dependency & framework upgrade agent
  scope: Svelte/Rust/Tauri/Workers upgrade proposals.
  status: not-started
  evidence: No agent artifact; upgrades are manual (e.g. branch deps/coupled-major-bumps, @types/node bump PR #15).

- id: maintenance-agents.platform-watch
  name: Cloudflare platform-watch agent
  scope: Track D1/Workers/Containers platform changes and flag impact.
  status: not-started
  evidence: No agent artifact in .claude/skills/, .github/workflows/, or docs.

- id: maintenance-agents.compliance-watch
  name: Compliance-watch agent
  scope: Bar/IOLTA rule-change monitoring keeping the trust catalog current.
  status: not-started
  evidence: No agent artifact; trust-rules research corpus (docs/research/trust-rules/) is manually maintained.

- id: maintenance-agents.competitive-watch
  name: Competitive-watch agent
  scope: Monitor competitor changelogs/feature pages; flag new features and gaps.
  status: not-started
  evidence: No agent artifact; docs/research/competitive-analysis.md is manual research.

- id: maintenance-agents.diagnostics
  name: Diagnostics agent
  scope: Triage incoming incident reports, correlate to traces, draft root-cause, propose draft-PR fixes, acknowledge the reporter.
  status: not-started
  evidence: packages/telemetry/src/events.ts names incident.created as "the diagnostics agent's future feed"; no queue consumer or agent exists.

- id: maintenance-agents.docs-maintenance
  name: Docs-maintenance system (docs-sync)
  scope: Per-merge deterministic fragment assembly plus a weekly judgment-bearing propose-only routine: draft changelog fragments, flag coverage gaps, roll up ROADMAP, one PR per run.
  status: in-build
  adrs: ADR-0058
  spec: docs/specs/2026-07-14-docs-sync-routine-design.md
  evidence: docs/maintenance/, .claude/skills/docs-sync/SKILL.md, .github/workflows/assemble-docs.yml — all on branch claude/docs-sync-routine-setup-c3hy7m, unmerged.

- id: maintenance-agents.docs-maintenance.per-merge-assembly
  name: Per-merge fragment assembly workflow
  scope: CI workflow on every push to main folding changelog.d/, docs/decisions/pending/, and status.d/ into the rendered trackers.
  status: in-build
  evidence: .github/workflows/assemble-docs.yml on this branch; repaired status-build collisions recorded in docs/maintenance/reports/2026-07-14-baseline.md.

- id: maintenance-agents.docs-maintenance.weekly-routine
  name: Weekly docs-sync routine
  scope: Scheduled fresh-session routine executing .claude/skills/docs-sync/SKILL.md; audits the merge window, opens one docs-sync PR.
  status: in-build
  evidence: Skill + canonical trigger configuration in docs/maintenance/README.md; the Routine itself is not yet created (pending owner sign-off).

- id: maintenance-agents.docs-maintenance.run-reports
  name: Run-report registry
  scope: One append-only report per run under docs/maintenance/reports/ carrying machine-readable window state.
  status: in-build
  evidence: docs/maintenance/reports/2026-07-14-baseline.md (verified baseline, first window-end pinned).

- id: maintenance-agents.docs-maintenance.ci-doc-hygiene
  name: Deterministic doc-hygiene CI rules
  scope: CI-side lint for cross-reference violations, process-ref scanning, and fragment validity — the deterministic residue the agent must not own.
  status: partial
  evidence: lint:process-refs in CI and status-fragment lint joined the gate governance job (commit 6452603); dead-link and empty-Unreleased gates not yet found in gate.yml.
