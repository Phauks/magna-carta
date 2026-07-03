@echo off
rem Runs only the design-system package tests: unit tests plus every Storybook story as a
rem browser-mode test in headless Chromium, with the axe accessibility gate failing on violations.
cd /d "%~dp0.."
call pnpm --filter @magna-carta/design-system test
pause
