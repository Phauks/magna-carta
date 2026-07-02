# Visual regression — story x theme x mode screenshots

Playwright screenshots of **every story in the static catalog build, across every theme and both modes**, compared against committed baselines. The matrix is dynamic on both axes: stories come from `storybook-static/index.json`, themes/modes from [`.storybook/catalog-matrix.ts`](../.storybook/catalog-matrix.ts) (the same single source the Storybook toolbar uses). A new story or a new theme is covered automatically — nothing to register here.

Spec: "Catalog, testing & enforcement" in [`docs/specs/2026-06-10-design-system-foundation-design.md`](../../../docs/specs/2026-06-10-design-system-foundation-design.md). Argos CI is the named upgrade path when baseline review outgrows git.

## Running

```
pnpm --filter @magna-carta/design-system run storybook-build        # build the static catalog first
pnpm --filter @magna-carta/design-system run visual-regression      # compare against baselines
```

Or double-click [`tools/run-visual-regression.cmd`](../../../tools/run-visual-regression.cmd) (builds, then runs). Chromium only for now; the suite is deliberately **not** part of `vp test` — it needs the static build and the baseline discipline below.

## Baseline discipline (CRITICAL)

**Baselines are authoritative ONLY from the pinned Playwright container** — `mcr.microsoft.com/playwright:v<version>-noble`, where `<version>` is the installed `@playwright/test` version (the update scripts derive it automatically). Font rasterization, antialiasing, and subpixel layout differ across operating systems; a baseline rendered on Windows or macOS is a different image than the same story rendered in CI's Linux container, and committing it poisons the suite for everyone.

- **Never commit baselines generated outside the container.** `visual-regression-update` exists for advisory local iteration only; discard its output unless it ran inside the container.
- **Regenerate via the container:** run [`update-baselines.cmd`](update-baselines.cmd) (Windows) or [`update-baselines.sh`](update-baselines.sh) (POSIX). Both require Docker, mount the repo into the pinned image, install, build the catalog, and rewrite `baselines/`. Caveat: the in-container `pnpm install` rewrites `node_modules` with Linux binaries — re-run `vp install` on the host afterwards.
- **No baselines yet?** The suite **skips explicitly** (a named, logged skip per test — never a silent pass) until baselines exist. Docker was not available on the original development machine, so the first authoritative baselines land via the CI container job (Task 28 of the implementation plan) — or locally once Docker is installed, via the update scripts.
- **Local non-container runs are advisory.** Once container baselines are committed, running `visual-regression` on Windows/macOS will report diffs that are pure font-rendering noise. Treat local output as a smoke check of the harness, not a verdict on the UI; the verdict comes from the container/CI run.

Baseline filenames carry no platform suffix (`snapshotPathTemplate` pins `baselines/<story>-<theme>-<mode>.png`) precisely because only one rendering environment is authoritative.

## Harness layout

| File                   | Role                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| `catalog.spec.ts`      | Generates one test per story x theme x mode; asserts the theme/mode actually applied before capturing. |
| `playwright.config.ts` | Chromium project, reduced motion, animations disabled, the no-platform-suffix baseline path.           |
| `serve-static.mjs`     | Dependency-free `node:http` server for `storybook-static/` (iframe assets break over `file://`).       |
| `baselines/`           | Committed container-authoritative screenshots.                                                         |
| `test-results/`        | Playwright output (actual/diff images on failure) — gitignored.                                        |
