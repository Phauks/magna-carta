# Tools — double-click launchers for common tasks

Owner-facing launchers for the things you open most: the Storybook catalog, the local app, tests, and the quality gate. Every script works from any checkout of the repo (paths are relative to this folder), opens its own terminal window, and stays open so you can read the output.

| Launcher                          | What it does                                                                                                                                                                                                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open-storybook.cmd`              | Starts the design-system catalog (Storybook) at http://localhost:6006 and opens it in your browser. Stop with Ctrl+C.                                                                                                                                                                       |
| `build-storybook-catalog.cmd`     | Builds the static catalog to `packages/design-system/storybook-static/` (the CI / visual-regression artifact).                                                                                                                                                                              |
| `run-local-app.cmd`               | Runs the full local app (builds the web SPA, then `wrangler dev` with local D1/R2/Queues) at http://localhost:8787.                                                                                                                                                                         |
| `run-all-tests.cmd`               | Runs every test in the repo (`vp test run`), including the Storybook story tests in headless Chromium.                                                                                                                                                                                      |
| `run-design-system-tests.cmd`     | Runs only the design-system package tests (unit + stories-as-browser-tests with the axe accessibility gate).                                                                                                                                                                                |
| `run-quality-gate.cmd`            | Runs the full quality gate (`pnpm check`: format + lint + type-check + svelte-check) — the same gate CI runs.                                                                                                                                                                               |
| `run-visual-regression.cmd`       | Builds the static catalog, then screenshots every story x theme x mode against the committed baselines (advisory on Windows; baselines come from the pinned container — see [`packages/design-system/visual-regression/README.md`](../packages/design-system/visual-regression/README.md)). |
| `install-playwright-chromium.cmd` | One-time setup: downloads the Chromium build the story tests run in. Run this if tests complain about a missing executable.                                                                                                                                                                 |

Terminal equivalents live in the repo [`CLAUDE.md`](../CLAUDE.md) "Commands" section; the catalog-specific ones are:

```
pnpm --filter @magna-carta/design-system storybook          # dev catalog (port 6006)
pnpm --filter @magna-carta/design-system storybook-build    # static catalog build
pnpm --filter @magna-carta/design-system test               # unit + story tests
pnpm --filter @magna-carta/design-system visual-regression  # screenshot sweep (build the static catalog first)
```

Known gotcha (Windows + OneDrive): if a build fails with `EPERM`, pause OneDrive sync first — see the repo `CLAUDE.md`.
