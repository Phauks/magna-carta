---
branch: claude/matter-assets-design
worktree: C:/dev/magna-carta-worktrees/claude/matter-assets-design
area: Matter assets — design only (spec + implementation plan for the matter-attached asset register)
status: designing
touches: docs/specs/, docs/decisions/pending/, changelog.d/, docs/active-work/
---

Design-only stream: the matter-attached asset register the owner asked for — real property with
address and parcel number, financial accounts, vehicles, firearms, business interests, digital
assets and the rest; documents attached to an asset; interests held by Directory entities;
valuations over time rather than one mutable number; and the estate schedule that falls out of it.
**No product code in this stream.** It writes two specs, one decision fragment, and one changelog
fragment, and touches nothing in `packages/` or `apps/`.

Coordinates with, and deliberately does not contradict: the merge-field catalog design (asset
classes become list-valued subjects riding one new source), the custodian design (the boundary is
stated crisply — Custodian holds physical originals, the register describes what the client owns),
and the custom-fields engine (one additive `custom_field.target` value, the same widening Custodian
already specified for its packet). A concurrent stream building in `packages/custodian`,
`packages/custom-fields`, `packages/document-assembly`, or `packages/matters` will not collide with
these files, but should read the design before adding a second per-matter register.
