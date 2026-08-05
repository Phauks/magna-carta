---
branch: claude/automation-directory-role-sources
worktree: C:/dev/magna-carta-worktrees/claude/automation-directory-role-sources
area: Document automation — directory role merge sources (opposingParty.*, opposingCounsel.*, guardian.*, witness.*) resolved through the matter's party links
status: building
touches: packages/document-assembly, packages/telemetry/src/metrics.ts, packages/fixtures/src/load-profile, packages/merge-field-catalog-contract, apps/worker/src/assemblies, docs/user/features/document-templates-and-assembly.md, status.d/2-6-document-automation.md, changelog.d, docs/decisions/pending
---

Extends the merge-field dictionary with directory role sources: a template can name the opposing
party, opposing counsel, a guardian, or a witness the way it already names the client, and can walk
every party in one of those roles with a repeating block. Everything resolves from the party read the
merge context already issues — no new statement, no new index, no migration. Ambiguity (two parties in
one role) and absence (none) both land as an unresolved value carrying a reason, which is new shape on
`MergeContext` (`absenceReasons`) and on `AssemblyAbsence` (`reason`).

Does not touch the OpenAPI surface, the api-client, or any migration. Bumps the load profile's
`GENERATOR_VERSION` and regenerates `packages/fixtures/baselines/ledgerVolume-v9.json` (the dictionary
widened, so the probe template's manifest is wider). A concurrent stream editing the load-profile
baseline or `packages/telemetry/src/metrics.ts` should sync before touching them.
