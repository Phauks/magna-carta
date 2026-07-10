# file-surface-web

**Scope:** Build the user-facing **file surface** — the shared multi-view shell + the headerless file
body (collection region + capability detail pane) — and stand it up on **real data**, Matter host first.
This is "stream three" of the Matter File Manager design, built on top of the app shell rather than
waiting for it to land on `main`.

Design (converging into one home):

- [`docs/specs/2026-07-09-matter-file-manager-design.md`](../specs/2026-07-09-matter-file-manager-design.md) — the approved matter surface (shared shell, modular views, streams).
- [`docs/specs/2026-07-09-file-inspector-workbench-design.md`](../specs/2026-07-09-file-inspector-workbench-design.md) — the headerless-body / hosts / `FileSource` reframe. The inspector is the Tools host of the same surface; its capability pane is the shared detail panel.

## Base & integration

- Branched from `slice-0-7b-app-shell` (the only branch with `apps/web`).
- Merged `file-manager-primitives` (Dropzone / Tree / FileIcon / Breadcrumb / ContextMenu) — reuse, not reinvent.
- Merged `file-manager-contract` (folders.list, enriched FileSummary, uploads.get, dev R2 upload route). Generated api-client conflicts were resolved by regeneration, not hand-merge (`emit-openapi` → `generate-client`). One-time wasm build (`decryption-core`) was needed for the worker to load; do the same in any fresh worktree.

## Progress

- **Shared multi-view shell + persisted-preference primitive — built.** `apps/web/src/lib/view-shell/` (headerless: `createViewShell` controller + `view-switch` + `view-shell-body` + pure types; registrable views, regions record, shared selection) and `apps/web/src/lib/preferences/` (`createPersistedPreference` over a codec). Six preference call sites migrated onto the primitive; `/tools` ported onto the shell as the proving consumer. `appearance-axes` deliberately NOT migrated (theme persists through the design-system boot-script seam — one home). svelte-check clean, web unit tests green.

## Real-data path (no fixtures baked into the UI)

The surface binds to the typed `@magna-carta/api-client` TanStack Query hooks. Real-vs-mock is a transport
choice behind that seam — nothing to rip out later.

1. Contract integration (above) so the folder browser + upload outcome have a contract.
2. `seed-dev-firm` script — firm + matter + files + user, so there is real data.
3. Login page + Better Auth dev session, so typed calls carry a session instead of 401.
4. `vp run worker-dev` (Miniflare local D1/R2/Queues) — real backend locally.
5. Build the **Matter Files host** against that real data. The **Tools host** reuses the same body with an
   ephemeral `FileSource` swapped in once its scratch backend exists; until then its gaps are typed absence,
   not fixtures.

## Files expected to be touched

- `apps/web/src/lib/` — the multi-view shell (regions record, view registry, shared selection), the file
  body (collection region + capability detail pane), the persisted-preference primitive (extracted; 5 call
  sites migrate).
- `apps/web/src/routes/(app)/matters/[id]/files/` (Matter host) and `apps/web/src/routes/(app)/tools/file-inspector/` (Tools host).
- `apps/web/src/routes/(app)/tools/` — port `/tools` onto the shell as the proving consumer.
- A `seed-dev-firm` script + a dev login route.
- On contract integration: generated `apps/worker/openapi/openapi.json`, `packages/api-client/src/*.gen.ts`.

**Never edited:** `packages/file-manager/src/ingest-core.ts`.

## Overlaps

- Owns `apps/web` file-surface work; coordinate with `slice-0-7b-app-shell` (shared `apps/web`) — this branch
  is built on top of its tip.
- Consumes `file-manager-contract` and `file-manager-primitives`; those land to `main` independently.
