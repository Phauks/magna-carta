---
category: Added
audience: internal
---

The whole-repo security audit is now scheduled: a weekly Claude Code Routine (`MC - Security Audit`, Wednesdays 13:00 UTC, fresh session per firing) runs the vendored security-audit skill in full audit mode over `main`, opens one `remediate-` pull request per confirmed finding with a regression verifier, and reports needs-validation leads by notification. Audit artifacts never enter the repository. The canonical configuration lives beside the audit policy in `docs/conventions/testing.md`, the `maintenance-agents.security` roadmap node moves to partial, and the pull request template gains a row asking whether the security angle was run against the companion files the change reaches.
