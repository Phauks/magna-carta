---
category: Changed
audience: internal
---

**The build register renders on `main`, never on a branch.** `docs/now.md`, `docs/now.html` and `docs/decisions-open.html` were rendered by every branch that flipped a `roadmap.d/` node, so any two such branches rewrote the same whole document and conflicted on it: fifteen of the last forty merges to `main` touched the file, and a trust pull request hit the conflict three times in four days on a file nobody had written by hand. The register is a derived view of the trunk, so the trunk renders it, as it already did for `CHANGELOG.md` and the Decision-Log register: the per-merge assembly workflow when it has minutes, the weekly docs-sync routine otherwise. `tooling/doc-fragments/register-renderers.mjs` says who renders (`main`, `docs-assembly`, `docs-sync/*`); `vp run register-build` refuses to write anywhere else (`--preview` shows the render without committing it); and `pnpm run lint:roadmap` holds the files to a fresh render where they are rendered and fails a branch that carries a change to them, with the `git checkout` that restores them. A branch's whole change is its ledger edit.
