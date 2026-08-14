# claude/build-register

**Scope:** Rebuild `docs/now.md` into the complete build register — every ledger node with its real
status, led by the arithmetic over the whole set — and withdraw the rendered public roadmap until
there are users to read it. The generator, the ledger keys and the artifact schema behind the public
document all stay; only the rendered document goes.

**Files expected to touch:**

- `tooling/doc-fragments/roadmap.mjs` (the renderers), `tooling/doc-fragments/build-register.mjs`
  (renamed from `build-public-roadmap.mjs`), `tooling/doc-fragments/roadmap.test.mjs`
- `tooling/lint-roadmap.mjs` (drift gate now holds one document, not two)
- `docs/now.md` (regenerated), `docs/public-roadmap.md` (deleted)
- `vite.config.ts` (`register-build` replaces `public-roadmap-build`),
  `.github/workflows/assemble-docs.yml`
- Pointer lines only: `CLAUDE.md`, `ROADMAP.md`, `roadmap.d/README.md`,
  `docs/conventions/documentation.md`, `docs/user/features/product-roadmap.md`,
  `packages/product-updates/CLAUDE.md`
- `docs/specs/2026-08-13-public-roadmap-design.md` (a withdrawal note, not a rewrite)
- `changelog.d/`, `docs/decisions/pending/` fragments

**Not touching:** `roadmap.d/*.md` node content, `STATUS.md`/`status.d/`, `CHANGELOG.md`, the
Decision-Log register, any application code.
