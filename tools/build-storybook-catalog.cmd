@echo off
rem Builds the static Storybook catalog (the CI / visual-regression artifact).
rem Output: packages\design-system\storybook-static\
cd /d "%~dp0.."
call pnpm --filter @magna-carta/design-system storybook-build
echo.
echo Static catalog written to packages\design-system\storybook-static\
pause
