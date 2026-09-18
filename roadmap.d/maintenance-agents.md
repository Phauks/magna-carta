# Maintenance Agents

<!-- Feature ledger fragment. One block per node; flat list; hierarchy encoded in the dotted id. Schema: roadmap.d/README.md -->

- id: maintenance-agents
  name: Maintenance agents
  scope: Scheduled propose-only Claude agents plus CI tooling (open PRs/reports, never auto-merge; trust/ledger/conflicts paths always human-reviewed).
  status: partial
  adrs: ADR-0016, ADR-0058
  evidence: The docs-maintenance system is on main (.claude/skills/docs-sync/, .github/workflows/assemble-docs.yml, docs/maintenance/) and has produced dated run branches since 2026-07-20. The security agent is the second scheduled one: a weekly Routine runs the vendored security-audit skill over main and opens one remediation pull request per confirmed finding (canonical configuration in docs/conventions/testing.md, Whole-repo security audit). The remaining five have no agent artifact.

- id: maintenance-agents.security
  name: Security agent
  scope: pnpm/cargo audit, CVE triage, secret scanning on a schedule.
  status: partial
  surface: internal
  evidence: A weekly Claude Code Routine (`MC - Security Audit`, Wednesdays 13:00 UTC, fresh session per firing, created 2026-09-17) runs the vendored .claude/skills/security-audit/ skill in full audit mode over main and opens one `remediate-` pull request per confirmed finding, each carrying a regression verifier; needs-validation leads reach the owner in the run's notification. Its canonical configuration and delivery rules live in docs/conventions/testing.md (Whole-repo security audit). Still gate-side rather than scheduled: the `audit` dimension of `pnpm gate` runs a pinned osv-scanner over both supply chains before every merge, with the accepted-advisory register at osv-scanner.toml. Not yet covered by any agent: CVE triage of new advisories against the unchanged lockfile (they surface only when a branch runs the gate), and scheduled secret scanning beyond `lint:secrets` on the tracked tree. The first firing is 2026-09-23; the node moves to shipped once a run has delivered.

- id: maintenance-agents.dependency-upgrade
  name: Dependency & framework upgrade agent
  scope: Svelte/Rust/Tauri/Workers upgrade proposals.
  status: not-started
  evidence: No agent artifact. renovate.json configures a propose-only, pinning, weekly-scheduled bot with osvVulnerabilityAlerts on and a drizzle-below-1.0 package rule, so the configuration half is committed; whether the GitHub App is installed on the repository is not readable from the tree, and no bot-authored commit appears in main's history. Framework upgrades land as manual branches (e.g. deps/coupled-major-bumps).

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
  status: partial
  adrs: ADR-0058
  spec: docs/specs/2026-07-14-docs-sync-routine-design.md
  evidence: docs/maintenance/, .claude/skills/docs-sync/SKILL.md and .github/workflows/assemble-docs.yml are all on main; the deterministic half runs on every push and the run-report registry has entries beyond its baseline. Roll-up of children that mix shipped and not.
  notes: Was in-build against branch claude/docs-sync-routine-setup-c3hy7m, which now carries only a small residue over main.

- id: maintenance-agents.docs-maintenance.per-merge-assembly
  name: Per-merge fragment assembly workflow
  scope: CI workflow on every push to main folding changelog.d/, docs/decisions/pending/, and status.d/ into the rendered trackers.
  status: shipped
  surface: internal
  evidence: .github/workflows/assemble-docs.yml on main, triggered on push to main, delivering the assembly as an auto-merging pull request from the docs-assembly branch.
  notes: Was in-build against the branch it was written on; that branch's remaining diff over main is four files.

- id: maintenance-agents.docs-maintenance.weekly-routine
  name: Weekly docs-sync routine
  scope: Scheduled fresh-session routine executing .claude/skills/docs-sync/SKILL.md; audits the merge window, opens one docs-sync PR.
  status: partial
  surface: internal
  evidence: Skill + canonical trigger configuration in docs/maintenance/README.md; the Routine itself is not yet created (pending owner sign-off).
  notes: Partial rather than in-build: the skill and its trigger configuration exist and the Routine itself is not created, which is an owner decision rather than work in progress.

- id: maintenance-agents.docs-maintenance.run-reports
  name: Run-report registry
  scope: One append-only report per run under docs/maintenance/reports/ carrying machine-readable window state.
  status: shipped
  surface: internal
  evidence: docs/maintenance/reports/ on main holds the pinned baseline plus a report per run whose pull request merged (2026-08-04 and 2026-08-12), each carrying the window-start/window-end frontmatter the next run reads its window from. Runs whose pull request was closed unmerged leave a docs-sync/YYYY-MM-DD branch and no report, which is why the 2026-08-12 window spans 141 merges rather than one week.
  notes: Was in-build against the branch the registry was written on; the registry is on main and in use.

- id: maintenance-agents.docs-maintenance.ci-doc-hygiene
  name: Deterministic doc-hygiene CI rules
  scope: CI-side lint for cross-reference violations, process-ref scanning, and fragment validity — the deterministic residue the agent must not own.
  status: partial
  surface: internal
  evidence: The gate's Governance step no longer lists its lints — it derives them from every lint:\* script in package.json (tooling/check-scoped/run-repo-wide-lints.mjs --all), so lint:process-refs, lint:status, lint:roadmap, lint:ledger-staleness, lint:decisions and lint:changelog-fragments all run on every pull request without being named. Fragment validity is covered on both directories; no dead-link lint and no empty-Unreleased lint exists as a script, which is what is still missing rather than a wiring gap.
