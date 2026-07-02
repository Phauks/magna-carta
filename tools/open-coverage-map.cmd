@echo off
rem Starts the government-records coverage map (rebuild-enabled) and opens it in your browser.
rem Runs a small local server so the in-page "Rebuild data" button can regenerate from the live
rem registry. Property / business / licensing coverage; click any region to open its search.
rem Close this window or press Ctrl+C to stop the server.
cd /d "%~dp0.."
echo Starting the coverage map server (opens your browser; Ctrl+C to stop) ...
call pnpm --filter @magna-carta/government-links coverage:serve
pause
