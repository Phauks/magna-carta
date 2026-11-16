---
category: Fixed
audience: public
---

**Repair and Text Recognition say which fault stopped them.** Both routes already answered 503 for two different faults: no engine binding in the deployment ("Recognition engine unavailable", "Recovery engine unavailable") and an engine that is bound but answered an error ("Recognition failed", "Diagnosis failed", "Recovery failed"). The Workbench tabs showed one sentence for both; they now read the problem's title and say "not set up on this server" or "the engine returned an error". The routes also count each engine failure (`ocr.engine_failure`, `file_repair.engine_failure`) with the engine's status and its own error code, never file content, so a Container that fails to start can be told from a file the engine could not handle (`apps/api-worker/src/http/routes/files/ocr.ts`, `apps/api-worker/src/http/routes/files/file-repair.ts`).

## Public

When Repair or Text Recognition cannot run, the tab now says whether the feature has not been set up yet or the engine behind it is failing, so you know whether to wait or to tell your administrator.
