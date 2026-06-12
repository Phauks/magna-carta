@echo off
rem Builds the static Storybook catalog, then runs the Playwright visual-regression sweep
rem (every story x theme x mode, headless Chromium) against the committed baselines.
rem Skips explicitly while no baselines exist; baselines are authoritative ONLY from the
rem pinned Playwright container — see packages/design-system/visual-regression/README.md.
cd /d "%~dp0.."
call pnpm --filter @magna-carta/design-system run storybook-build && call pnpm --filter @magna-carta/design-system run visual-regression
pause
