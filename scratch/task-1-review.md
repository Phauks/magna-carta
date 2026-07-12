# Task 1 review — Tool presentation module + dependency wiring

## Verdict: Spec compliance — PASS

Checked against `docs/specs/2026-07-08-tools-listing-page-implementation-plan.md` § Task 1 +
Global Constraints, and against the live catalog (`packages/tools/src/catalog.ts` +
`types.ts`, 16 tools / 8 subject groups / 16 distinct icon names as of this review).

- `TOOL_PRESENTATION` (`apps/web/src/lib/tools/tool-presentation.ts:34-127`): 16 keys, exact match
  to `CATALOG` ids (property-listing-links, county-property-records, business-entity-lookup,
  attorney-license-lookup, shipping, network-speed-test, firm-usage, whois-lookup,
  safe-website-viewer, file-converter, metadata-scrubber, file-hash-integrity, file-decryption,
  file-type-verifier, ai-text-detection, file-repair). No missing, no extra. Every entry
  `stage: "soon"` — honest, matches "no tool page exists yet." Descriptions are plain,
  single-sentence, no marketing voice, no process-doc references.
- `TOOL_ICONS` (`tool-presentation.ts:143-159`): 16 entries, exact match to every `icon` value
  used in the catalog, including `wrench` for `file-repair` (verified the Lucide package ships
  `icons/wrench.svelte`). No missing, no extra.
- `SUBJECT_GROUP_LABELS` (`tool-presentation.ts:130-139`): 8 entries, exact match to
  `SUBJECT_GROUP_ORDER`, including `files` (correctly renamed from the plan's stale `documents`
  key — the plan's literal key is not a `SubjectGroup` member anymore and would not compile).
- `visibleToolGroups()` (`tool-presentation.ts:165-167`): thin wrapper over the shared
  `toolsByGroup(CATALOG, mockPermissions)` gate; `mockPermissions` is derived from the live catalog
  (`CATALOG.map(t => t.permission)`), with a comment explaining the seam (mock all-permissions
  today, swapped for real grants when auth lands, call site unchanged). Matches the "same gate the
  contextual tool surfaces use" requirement.
- Completeness test (`apps/web/test/tools-presentation.test.ts`) genuinely asserts: re-ran it
  directly (`vp test run --project web test/tools-presentation.test.ts`) — 5/5 pass. The
  "surfaces the whole catalog exactly once" assertion is a real deep-equal against sorted catalog
  ids, not a tautology; it independently caught the `file-decryption` subject-group bug during
  implementation (see below), which is exactly the kind of regression it exists to pin.
- Global constraints: no raw CSS (data module, no markup); Lucide icons throughout; no emojis; full
  names used everywhere (`TOOL_PRESENTATION`, `SUBJECT_GROUP_LABELS`, `visibleToolGroups`, no
  shorthand); grepped both new files for `ADR|spec|slice \d|Phase \d` — zero hits, clean of
  process-doc references; test lives at `apps/web/test/tools-presentation.test.ts` and imports the
  module by relative path (`../src/lib/tools/tool-presentation.ts`); `packages/tools` is untouched
  by the Task 1 commit itself (`646e37f`) — confirmed via `git show 646e37f --stat`, which lists
  only `apps/web/**` and `pnpm-lock.yaml`.
- Nothing over-built: file list matches Task 1 exactly (`package.json`, `tool-presentation.ts`,
  the test) plus one justified supporting change (`vitest.config.ts`, see Quality) and one
  separately-committed, owner-approved domain fix (`41985e1`, see below) — no Task 2/3 work leaked
  in, no extra exports beyond the four the plan's Interfaces section names.

**On the domain fix (commit `41985e1`, "put file-decryption on the files subject group"):** this
is the one-line `packages/tools/src/catalog.ts:133` correction, landed as its own commit after the
Task 1 commit rather than inside it. The Task 1 commit (`646e37f`) itself correctly left
`packages/tools` untouched per the plan's constraint and documented the bug in its own commit
message and the report; the fix was applied separately once approved. Both commits are in the
reviewed range and consistent with each other — not a defect.

## Verdict: Code quality — Approved

Findings, tagged by severity:

- **Minor** — `apps/web/vitest.config.ts:1-25`: adding `plugins: [svelte()]` +
  `server.deps.inline: ["@lucide/svelte"]` is the right fix for a real problem (Lucide's
  `icons/*` subpaths re-export raw `.svelte` source, which Node's default SSR externalization
  can't parse — confirmed independently: `node -e "import('@lucide/svelte/icons/house')"` throws
  `ERR_UNKNOWN_FILE_EXTENSION`). It's scoped tightly (base Svelte compiler plugin, not the full
  SvelteKit plugin — `$lib` still doesn't resolve here, as intended; `deps.inline` names only the
  one package that needs it, not a blanket inline-everything). The only soft cost: this config is
  no longer literally "plugin-less," a phrase the plan's Global Constraints uses to describe it —
  but the constraint is describing the mechanism tests should use (relative imports, no `$lib`),
  not forbidding ever touching the config, and no test in this range imports via `$lib`. No action
  needed; flagging only so a future reader of that phrase in the plan isn't surprised by the diff.
- **Minor** — `tool-presentation.ts:143-158`: `TOOL_ICONS` is typed `Record<string, Component>`
  (loose string key) rather than `Record<ToolManifest["icon"], Component>` or similar, so a typo'd
  icon name would silently type-check. This matches the plan's own Interfaces section verbatim, so
  it's not a deviation — just noting the completeness test is the only guardrail here, and it does
  the job (confirmed passing).
- No Critical or Important findings. Naming, imports, comments, and structure all read as
  intentional and match the codebase's existing idioms (e.g. explicit icon imports mirroring
  `destinations.ts`).

## Bottom line

Spec: PASS (complete against the live catalog, nothing missing, nothing extra). Quality: Approved,
two Minor notes only (both informational, no changes requested).
