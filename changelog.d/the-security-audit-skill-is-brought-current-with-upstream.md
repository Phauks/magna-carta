---
category: Changed
audience: internal
---

The vendored `security-audit` skill (`.claude/skills/security-audit/`, Cloudflare, MIT) is refreshed to upstream commit `c1c8a8c` of 2026-09-14. The copy landed on 2026-09-11 was already three months behind: it carried the seven original files and none of the domain companions upstream had added since July.

What arrives: a coverage ledger (`coverage-ledger.json`, with its own validator and test suite) so a run records what it checked, not only what it found; a third verdict, `needs_validation`, for a lead with an exact unresolved fact and no severity, so a blocked lead is no longer either inflated to confirmed or dropped; a guidance mode, so loading the skill for a security question no longer starts the six-phase audit or writes files; an execution-safety rule that runs target code only inside an OS-enforced sandbox and otherwise keeps the lead as needs-validation; and ten domain hunting files, of which the tenant-isolation, cloud-and-deployment, supply-chain, resource-exhaustion, and AI-and-LLM ones map onto this platform directly. `VENDORED.md` in the skill directory records the pinned commit and the refresh procedure; the directory joins the formatter's ignore list in `vite.config.ts`, because upstream owns the bytes and because the formatter corrupts one of its files on a second pass; and the security angle of the 7-angle review in `docs/conventions/testing.md` now names the companion files a slice picks from.
