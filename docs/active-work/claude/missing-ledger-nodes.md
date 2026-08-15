---
branch: claude/missing-ledger-nodes
worktree: /home/user/magna-carta/.claude/worktrees/missing-ledger-nodes
area: Give the three merged designs the register could not see — exhibits, translation services, and self-serve provisioning with the free tier — the ledger nodes they never got, and place their open owner flags
status: review
touches: roadmap.d/exhibits.md, roadmap.d/translation.md, roadmap.d/self-serve.md, docs/now.md, docs/register-history.json, changelog.d/
---

Documents only — no source, no schema, and no existing node's status touched. Three area files are
new, so nothing here collides with a stream editing an existing `roadmap.d/` fragment; the only
shared files are the two generated ones, `docs/now.md` and `docs/register-history.json`, which are
regenerated wholesale by `vp run register-build` and should be rebuilt after merging rather than
resolved by hand.

Twenty-five nodes added: eight plus a root for exhibits, six plus a root for translation, and eight
plus a root for self-serve provisioning and entitlements. Statuses are derived rather than chosen —
a merged design with a merged implementation plan and no code is `planned`, a merged design alone is
`designed`, what a design explicitly parks is `deferred`, and the one part of this that turns out to
be built already is `shipped` against the routes that hold it.
