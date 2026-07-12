# Final review — Tools listing page (`slice-0-7b-app-shell`)

**Verdict: Changes needed** — and the only thing standing between this and "Ready to merge" is
the documentation obligation in golden rule 5. The code is clean, coherent, and honest; the seam is
well-drawn; every golden rule that touches the source is satisfied. But the branch ships a new
user-facing surface with **no changelog fragment, no STATUS fragment update, and no ROADMAP update** —
by this project's own definition of "done," the feature is not done. Land those three fragments and
it merges.

---

## Findings

### Critical

None.

### Important

- **No changelog fragment** (`changelog.d/` — absent). Golden rule 5: a user-facing surface is not
  done without a `changelog.d/<slug>.md`. The `/tools` directory is a shipped, navigable page (the
  `tools` destination flips to `shipped: true` in `destinations.ts:317-318`), so it owes one.
  Blocker.
- **STATUS fragment stale / not updated** (`status.d/tools-area.md`). It still reads
  `built: done … ui: todo … branch: main` — it predates and does not reflect this listing page.
  The listing is exactly the "ui" deliverable for the Tools area. Either flip/annotate that fragment
  (note the listing page landed; per-tool UIs still todo; `branch: slice-0-7b-app-shell`) or record
  it in `status.d/0-7b-auth-ui-deferred-surfaces.md`. Branches must not hand-edit `STATUS.md`
  directly — this goes through the fragment. Currently neither fragment mentions the page. Blocker.
- **ROADMAP not updated** (`ROADMAP.md`). The branch's own active-work note
  (`docs/active-work/slice-0-7b-app-shell.md`) promises "ROADMAP stage updates"; none are present.
  ROADMAP is branch-editable (not a fragment file), so add the tools-listing line to the relevant
  row. Blocker per golden rule 5.

### Minor

- **ADR (optional, recommended).** One decision here outlives the spec: _tool presentation lives
  app-side; the domain catalog stays identity-only_. That is a real architectural boundary and a
  fair candidate for a `docs/decisions/pending/<slug>.md` fragment under golden rule 8. The design
  spec already records the reasoning, so this is a "should," not a functional blocker.
- **`+page.svelte` inline `style="letter-spacing: var(--mc-tracking-caps)"`** (section `<h2>`). Not a
  raw-CSS violation — it applies a defined token (`--mc-tracking-caps`, `tokens.css`) and is the
  established idiom across the app (matter pages, matter-header badge, the entire developer console).
  Consistent. No change.

---

## The four Minor items — triage

All four are **accept-with-reason**. None are fix-now.

1. **vitest.config gains `svelte()` + `deps.inline: ["@lucide/svelte"]`.** Accept. The completeness
   test's whole job is to assert every catalog icon _resolves to a real component_, so it must import
   `TOOL_ICONS`, whose values are the Lucide `.svelte` components — importing the module necessarily
   pulls `.svelte` sources. Isolating the icon map wouldn't remove that; it would only move it. The
   fix adds the **base** compiler plugin (not SvelteKit's, so the cwd-guard dance is avoided) and is
   minimal and correctly explained in the config comment. Legitimate.
2. **`Record<string, ToolPresentation>` loose key, not a literal `ToolId` union.** Accept. The design
   spec calls this out explicitly (decision 3): a literal union needs `CATALOG as const`, a
   domain-package change deliberately held out of this slice. The completeness test pins the key set
   to the catalog at CI — the guard is real and green. Documented trade.
3. **`toolPresentation()` / `toolIcon()` throw in template position.** Accept-with-reason. The throw
   can only fire if the catalog outruns this module _and_ CI (the completeness test) was bypassed — a
   near-impossible state. Fail-loud on a broken invariant is defensible; degrading one tile would
   hide a wiring bug that CI is built to catch. Optional future hardening, not a blocker.
4. **Module-level `storage` listener with no teardown.** Accept. This is a lifetime singleton (one
   listener per module for cross-tab sync), not a per-component subscription — there is nothing to
   leak, and it matches the `sidebar-preferences.svelte.ts` precedent exactly. Correct as-is.

---

## Documentation gap — concrete owed list

**Owed and missing:**

1. `changelog.d/tools-listing-page.md` — `category: Added`. One paragraph: the Tools area gets its
   first screen — a `/tools` directory listing every tool the firm offers, grouped by subject, in a
   card grid or a dense list (a persisted per-member toggle), each entry badged by maturity. Every
   tool reads "Soon" today (no tool has its own page yet) and nothing is launchable — an honest
   directory of what's coming, not a faked workbench. (Match the prose voice of
   `changelog.d/service-status.md`.)
2. A **STATUS fragment** reflecting the listing page: update `status.d/tools-area.md` (its `ui` field
   and `branch`) or add the row to `status.d/0-7b-auth-ui-deferred-surfaces.md`. Do **not** touch
   `STATUS.md`/`STATUS.json` on the branch.
3. `ROADMAP.md` — the tools-listing stage line the active-work note already promised.

**Owed judgement calls:**

4. `docs/user/` page — **not warranted yet.** User docs walk a user through a task; a directory where
   every entry is "Soon" and nothing is launchable has no task to document. It would only pre-announce
   surfaces that don't exist, which is exactly what this slice refuses to do. Defer to the first
   shipped tool page. (The existing per-tool user pages — shipping, whois, hash, metadata, safe-viewer,
   file-unlock — document tools whose backends exist and stand on their own; they are not this page's
   obligation.)
5. **ADR** — recommended but optional (see Minor above): a short pending fragment for the
   presentation-seam boundary would satisfy golden rule 8.

**Already done well:** `docs/active-work/slice-0-7b-app-shell.md` updated with scope and touched
files; design spec + implementation plan both committed. Good hygiene — the gap is purely the
changelog/STATUS/ROADMAP trio.

---

## Coherence, seam, and the specific checks — all clean

- **Domain vs presentation seam (clean).** `packages/tools` is untouched except the one approved
  data fix (`catalog.ts`: `file-decryption` `documents → files`, commit `41985e1`). No UI prose and
  no lifecycle state leaked into the domain; all descriptor/stage/label/icon-component mapping lives
  in `apps/web/src/lib/tools/tool-presentation.ts`. The app imports the domain's `CATALOG`,
  `toolsByGroup`, and types — never the reverse. This is the seam the spec promised.
- **Subject-group fix is correct and necessary.** `SUBJECT_GROUP_ORDER` uses `files`; the stray
  `documents` on `file-decryption` would have made `toolsByGroup` drop it into no rendered group (no
  `documents` group exists) — a real latent bug. `SUBJECT_GROUP_LABELS` keys `files` → "Documents &
  Files", matching. In-scope, correct.
- **`ready`/launchable branch (correct, currently dead-by-design).** `tool-tile.svelte:34-38` /
  `tool-row.svelte:29-33`: `launchable = stage === "ready"` → whole tile/row becomes
  `<a href="/tools/{id}">`. Every tool is `soon`, so the branch never renders today — an intentional
  forward seam, not dead code. The `href` target route doesn't exist yet, but since nothing is
  launchable no broken link is reachable. Dropping `aria-disabled` from the inert branch (commit
  `6436858`) is the right call — an inert card is not a disabled _control_.
- **Mock permission seam (honest, swaps cleanly).** `new Set(CATALOG.map(t => t.permission))` grants
  exactly the permissions the catalog declares, so `visibleToolGroups()` surfaces the whole catalog —
  the stated "managing partner sees everything" posture, same as Settings. When real grants land, only
  `mockPermissions` is replaced; the `toolsByGroup(CATALOG, …)` call site is unchanged. It bakes in no
  wrong assumption about permission _shape_ — it reuses the domain's real gate.
- **Golden rules (pass).** All icons Lucide; no emojis; design-system components only
  (`card`/`button`/`masthead`/`badge`) — no `bits-ui` imports; names fully spelled out
  (`visibleToolGroups`, `mockPermissions`, `TOOL_PRESENTATION`); no process-doc citations in source
  (the "when tool pages are built" comments are the allowed forward-looking kind); the one inline
  `style` applies a token, matching established precedent.
- **Nothing over-built or duplicated.** The two components share a prop shape and the launchable
  derive but differ only in layout; the `{#snippet body()}` pattern avoids duplicating the
  link/inert branch. Two views + toggle is the spec's explicit ask (owner compares treatments; the
  loser drops out with no data/logic change). Tests cover the two guardable seams (completeness +
  parse); the rest is browser-verified, per the app's established no-render-harness pattern.
