@echo off
rem Regenerates the government-records coverage map from the live registry, then opens it in your browser.
rem Toggle property / business / licensing; deep-link vs search-only shading; click any region to open its search.
cd /d "%~dp0.."
echo Regenerating coverage data from the registry ...
call pnpm --filter @magna-carta/government-links coverage:data
echo Opening the coverage map ...
start "" "packages\government-links\mockups\coverage-map.html"
pause
