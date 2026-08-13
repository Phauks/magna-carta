---
branch: claude/community-slice-1
worktree: .claude/worktrees/community-slice-1
area: Community surfaces slice 1 — the public changelog (fragment audience contract, assembly into a public home, and the generated artifact)
status: building
touches: tooling/doc-fragments/, tooling/lint-changelog-fragments.mjs, packages/product-updates/, changelog.d/, docs/public-changelog.md, package.json, .github/workflows/gate.yml, roadmap.d/product-updates.md, status.d/community-1-public-changelog.md, docs/user/features/public-changelog.md
---

The first of the three community surfaces: the **public changelog**, which the community-surfaces
design sequences first and alone. No board, no votes, no posts, and no database of any kind in this
slice.

What this stream owns:

- **`changelog.d/` fragment contract.** A required `audience:` key (`public` | `internal`, no
  default) and a `## Public` block carrying the customer-facing prose of a public fragment. Any
  branch adding a changelog fragment after this merges must set `audience:` or the gate refuses it.
- **`tooling/doc-fragments/changelog.mjs` and `build-changelog.mjs`.** The parser gains the two new
  fields and the assembler gains a second destination.
- **`docs/public-changelog.md`** — a new assembled home, the customer-facing sibling of
  `CHANGELOG.md`. Assembled on `main` by `vp run changelog-build`; never hand-edited on a branch,
  same rule as `CHANGELOG.md`.
- **`packages/product-updates`** — a new package holding the artifact schema and the generator that
  turns the assembled public home into `public-changelog.json`.
- **`pnpm run lint:changelog-fragments`** and its line in the gate's governance job.

Concurrent streams should know: **every branch that adds a `changelog.d/` fragment is affected.**
After this merges a fragment without `audience:` fails `pnpm run lint:changelog-fragments`. The fix
is one line. Streams in flight now carry fragments written before the key existed; they will need
that line added on rebase.

Not in this stream: the community board, `@magna-carta/community`, `apps/community-worker`, any
control-plane schema, and every screen. The changelog's own public page and the in-app updates route
are a separate dispatch and consume the artifact this stream produces.
