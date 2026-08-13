---
branch: claude/advisories
worktree: .claude/worktrees/advisories
area: Dependency-advisory triage and remediation across both supply chains
status: review
touches: pnpm-workspace.yaml, pnpm-lock.yaml, osv-scanner.toml, crates/Cargo.lock, containers/recovery/Cargo.lock, containers/scan/Cargo.lock
---

Triage of every open advisory in the audited lockfiles, and remediation of the ones that could be
taken safely. Nothing had been examined since 2026-08-04: the CI audit is the only thing that looks,
and GitHub Actions has assigned no runner since 2026-08-07, so the queue had been growing unread.

**Do not take a lockfile-touching change onto another branch while this is open** — the install
surface moved in one commit (five pins, one of them a framework minor), and a second branch
re-resolving `pnpm-lock.yaml` in parallel produces a merge nobody can review.

The full enumeration, per-advisory reachability reasoning, and what was deliberately left alone are
in the header of [`osv-scanner.toml`](../../../osv-scanner.toml) and the changelog fragment. Three
things want an owner decision and are called out there rather than settled here: the audit's fail
threshold is CVSS >= 7.0, which means five of the eleven findings GitHub reports would never have
blocked anything; RustSec advisories carry no CVSS and no severity text at all, so the classifier's
fallback treats every one of them as passing; and `wasmtime` in the malware-scan container cannot
reach its fixed line while `yara-x` requires `^43.0.2`.
