@echo off
rem Starts the design-system catalog (Storybook) and opens it in the default browser.
rem Storybook serves on http://localhost:6006; close this window or press Ctrl+C to stop it.
cd /d "%~dp0.."
echo Starting the Storybook catalog at http://localhost:6006 ...
call pnpm --filter @magna-carta/design-system storybook
pause
