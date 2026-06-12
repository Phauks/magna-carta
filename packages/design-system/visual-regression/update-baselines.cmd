@echo off
rem Regenerates the AUTHORITATIVE visual-regression baselines inside the pinned Playwright
rem container — the only rendering environment whose output may be committed (see README.md,
rem "Baseline discipline"). Requires Docker.
rem
rem The container tag is derived from the installed @playwright/test version so the browser
rem build matches the test runner exactly. Caveat: the in-container `pnpm install` rewrites
rem node_modules with Linux binaries — re-run `vp install` on the host afterwards.
setlocal

cd /d "%~dp0.."
for /f %%v in ('node -p "require('@playwright/test/package.json').version"') do set "PLAYWRIGHT_VERSION=%%v"
if not defined PLAYWRIGHT_VERSION (
  echo Could not determine the installed @playwright/test version — run vp install first.
  exit /b 1
)
set "CONTAINER_IMAGE=mcr.microsoft.com/playwright:v%PLAYWRIGHT_VERSION%-noble"

cd /d "%~dp0..\..\.."
echo Generating baselines in %CONTAINER_IMAGE% (mounting %CD%)
docker run --rm -v "%CD%:/work" -w /work "%CONTAINER_IMAGE%" bash -lc "corepack enable && pnpm install --frozen-lockfile && pnpm --filter @magna-carta/design-system run storybook-build && pnpm --filter @magna-carta/design-system run visual-regression-update"
if errorlevel 1 (
  echo Baseline generation FAILED — see the container output above.
  exit /b 1
)

echo.
echo Baselines rewritten in packages\design-system\visual-regression\baselines\.
echo Review the diffs, commit them, then re-run 'vp install' on the host (the container
echo install rewrote node_modules with Linux binaries).
