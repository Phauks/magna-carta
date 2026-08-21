@echo off
rem Runs the full quality gate: format + lint + TypeScript type-check (vp check) and svelte-check
rem for apps/web-worker and packages/design-system. This is the same gate CI runs.
cd /d "%~dp0.."
call pnpm check
pause
