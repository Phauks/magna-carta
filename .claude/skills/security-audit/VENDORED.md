# Vendored from cloudflare/security-audit-skill

This directory is a verbatim copy of the `skills/security-audit/` directory of
<https://github.com/cloudflare/security-audit-skill>, plus that repository's root `README.md` and
`LICENSE` (MIT). Nothing in it is edited locally, so a refresh is a copy, never a merge. The
directory is on the formatter's ignore list in the root `vite.config.ts`, because upstream owns the
bytes and because the formatter is not safe on this text (the reason is beside the entry).

| Field         | Value                                                |
| ------------- | ---------------------------------------------------- |
| Upstream      | `https://github.com/cloudflare/security-audit-skill` |
| Commit        | `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`           |
| Upstream date | 2026-09-14 ("Clarify guidance and full audit modes") |
| Vendored      | 2026-09-17                                           |

## Refreshing

1. Clone upstream at the commit you are taking, and copy `skills/security-audit/*`, `README.md`,
   and `LICENSE` over this directory. Delete any file upstream has dropped.
2. Run both validator test suites here with plain Node, and stop if either fails:

   ```
   node .claude/skills/security-audit/validate-findings.test.cjs
   node .claude/skills/security-audit/validate-coverage-ledger.test.cjs
   ```

3. Update the table above, and re-read the parts of `docs/conventions/testing.md` that name files in
   this directory, since upstream renames and adds companion files between releases.
4. Commit a `changelog.d/` fragment (internal). Do not edit the copied files to fit house style: the
   formatter skips this directory, the process-reference and control-character lints already skip
   `.claude/`, and the linter's warnings on the validators are warnings, not failures.

## Why the whole skill and not only `SKILL.md`

`SKILL.md` is an index. The phases it names live in the companion files, the findings contract is
`report-schema.json`, and the two `.cjs` validators are what make the phase outputs machine-checkable.
A copy that carries only the entry file reads as installed and is not.
