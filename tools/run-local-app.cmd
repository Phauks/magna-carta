@echo off
rem Runs the full local app: builds the web SPA, then wrangler dev (Miniflare: local D1/R2/Queues).
rem The app serves on http://localhost:8787; close this window or press Ctrl+C to stop it.
cd /d "%~dp0.."
call pnpm exec vp run worker-dev
pause
