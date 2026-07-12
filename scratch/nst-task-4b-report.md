# Task 4b report — Network Quality Score panel

## Files created

- `apps/web/src/lib/tools/speed-test/quality-labels.ts` — `useCaseLabel(key)`, labels `streaming`/`gaming`/`rtc`, falls back to the raw key for anything unrecognized.
- `apps/web/src/lib/tools/speed-test/quality-scores.svelte` — renders `Scores` (`Record<string, ExperienceScore>`) as a `<dl>` of use-case → classification + points; "Scored once a run finishes." when empty/undefined.
- `apps/web/test/quality-labels.test.ts` — 2 tests per plan (known labels, fallback).

## Files modified

- `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte` — imported `QualityScores`, inserted a new `<section>` ("Network quality score") between the headline-metrics grid and the "Your connection" section, passing `results?.getScores()`.

## Scores import

`Scores` imported cleanly as `import type { Scores } from "@cloudflare/speedtest";`. Confirmed by reading `apps/web/node_modules/@cloudflare/speedtest/dist/speedtest.d.ts` directly (Glob doesn't surface node_modules — it's gitignore-aware — so I read the file path directly): the package's `export { ... type Scores, ... }` at line 435 re-exports it from the root entry point. No structural fallback was needed. The engine store (`speed-test-engine.svelte.ts`, already on disk from Task 4) already imports `Scores` the same way and types `getScores(): Scores` on its `SpeedTestResults` interface, so the panel's prop type (`Scores | undefined`) lines up with `results?.getScores()` with no cast.

## Heading markup copied

Copied verbatim from the sibling "Your connection" `<h2>` already on the page (same file, existing code from Task 4):

```svelte
<h2
  class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
  style="letter-spacing: var(--mc-tracking-caps)"
>
```

Only the heading text changed ("Network quality score"). Verified `border-border-strong`, `text-text-muted`, and `--mc-tracking-caps` all exist in `packages/design-tokens/generated/tailwind-theme.css` / `packages/design-tokens/generated/tokens.css` before reusing them (they were already proven-in-use by the existing page, but I confirmed independently since the plan's literal snippet uses `text-status-critical-subtle-foreground` elsewhere, which does NOT exist — the shipped page already correctly uses `text-status-danger-subtle-foreground`, which I left untouched).

Spacing classes (`gap-16`, `mt-4`, `mb-16`, `pb-8`) are all on the closed Tailwind scale (0/4/8/12/16/20/24/32/40/48/64/96); no arbitrary values used.

## Unknown-key handling

`useCaseLabel` never drops a key — `USE_CASE_LABELS[key] ?? key` falls back to the raw string. `quality-scores.svelte` iterates `Object.entries(scores ?? {})` (no destructuring against a fixed use-case list), so any key the library adds later renders under its own name via the `{#each}` block, keyed by `key` for stable identity.

## Commands run

```
vp test quality-labels                                    # FAIL (module not found) — confirmed red before implementing
vp test quality-labels                                    # PASS, 2 tests — after implementing quality-labels.ts
pnpm --filter @magna-carta/web run check                  # 0 ERRORS 0 WARNINGS (5370 files)
vp test quality-labels speed-test-format connection-probe  # PASS — 3 files, 18 tests total
```

## Commit

`19276ec` — `feat(tools): network quality score panel`

Files in commit: `apps/web/src/lib/tools/speed-test/quality-labels.ts`, `apps/web/src/lib/tools/speed-test/quality-scores.svelte`, `apps/web/test/quality-labels.test.ts`, `apps/web/src/routes/(app)/tools/network-speed-test/+page.svelte`.

## Concerns

- None blocking. The Svelte autofixer reported zero issues on `quality-scores.svelte`.
- Did not touch `find.exe.stackdump` or other pre-existing untracked scratch files in the worktree root — they predate this task and are out of scope.
- Did not start a dev server per instructions; no browser verification performed.
