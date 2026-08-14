---
category: Added
audience: internal
---

`docs/now.md` is now **the build register**: every one of the 702 capability nodes in the
`roadmap.d/` feature ledger, at the status the ledger actually holds, led by the arithmetic over the
whole set. It is rendered by `vp run register-build` and diff-gated, so it cannot drift from the
state of the work.

**The counts come first, because they are what the document is read for.** A roll-up of done /
part-built / ahead / parked; every one of the nine statuses with its own count and share; and a
per-area matrix with a column per status, each area's total, and its shipped percentage. Percentages
are computed by largest remainder so a column of shares always sums to 100 beside a column of counts
that sums to the total.

**Nine statuses, nine columns — the bands are gone.** The previous rendering collapsed the ledger's
nine statuses into five horizon bands, which put `partial` (a shipped backend with no screen on it)
under the same heading as `in-build` (being written right now). Those are the two facts most worth
holding apart, and the register never bands them again.

**The gap between 34% and 60% is named in the document.** Shipped alone is 241 of 702; shipped plus
partial is 423. The 182 nodes in between are approximately the program's interface debt — engineered
and unreachable — and the register says so rather than leaving a reader to pick whichever number
flatters.

**Every node is listed, nothing collapsed.** The register prints all 702 in ledger order, grouped by
area, indented by the depth of the dotted id, with each node's id, status, name, scope and note. The
short lists above it — waiting on the owner, being built now, next up — no longer collapse a subtree
to its shallowest node either: a parent's status is a roll-up and its children are the actual units
of work.

**Where we were is stated as absent rather than invented.** The ledger holds only current status and
no history, so the register draws no trend line and says why, pointing at `CHANGELOG.md` as the only
dated record of what shipped.

**The public roadmap document is withdrawn until there are users.** `docs/public-roadmap.md` is
deleted and no longer generated: there are no users, so a document written for users has no reader,
and a document nobody reads is a document nobody keeps honest. Everything behind it stays and stays
tested — the renderer, the `audience` / `public-name` / `public-summary` / `public-group` ledger
keys, the public-copy rules in `pnpm run lint:roadmap`, and the artifact schema and strict parser in
`@magna-carta/product-updates`. The corpus test now renders that document in memory from the real
ledger and round-trips it through the artifact parser, so the guarantee the committed file carried
is intact without the file, and publishing again is one line in the assembler.

`vp run public-roadmap-build` is renamed `vp run register-build`, and
`tooling/doc-fragments/build-public-roadmap.mjs` is renamed `build-register.mjs`.
