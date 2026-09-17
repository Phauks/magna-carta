---
worktree: C:/dev/magna-carta-worktrees/claude/wizardly-curie-0ss1ld
area: Refresh the vendored security-audit skill to current upstream and point the testing convention at its new companion files
status: review
touches: .claude/skills/security-audit, docs/conventions/testing.md, changelog.d
---

Brings `.claude/skills/security-audit/` up to cloudflare/security-audit-skill commit `c1c8a8c`
(coverage ledger, needs-validation verdict, guidance mode, ten domain hunting files, validator tests)
and adds `VENDORED.md` there with the pin and the refresh procedure. The only shared file touched is
the security angle and the whole-repo audit section of `docs/conventions/testing.md`; nothing here
touches application code.
