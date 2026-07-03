@echo off
rem Runs every test in the repo (unit + integration + Storybook story tests in headless Chromium).
rem If story tests complain about a missing browser executable, run install-playwright-chromium.cmd once.
cd /d "%~dp0.."
call pnpm exec vp test run
pause
