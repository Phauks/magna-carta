@echo off
rem One-time setup: downloads the Chromium build that the Storybook story tests run in.
rem Re-run after a Playwright version bump if tests report a missing browser executable.
cd /d "%~dp0.."
call pnpm --filter @magna-carta/design-system exec playwright install chromium
pause
