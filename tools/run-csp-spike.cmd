@echo off
rem Re-runs the CSP style-src spike (bits-ui issue #1995): builds the probe app, serves it with
rem a strict Content-Security-Policy header, and drives headless Chromium through Dialog,
rem Popover and Tooltip. Fails if observed behavior diverges from the documented verdict in
rem packages/design-system/test/csp-spike/VERDICT.md. Re-run after any bits-ui upgrade.
cd /d "%~dp0.."
call pnpm --filter @magna-carta/design-system run csp-spike
pause
