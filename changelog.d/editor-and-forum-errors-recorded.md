---
category: Changed
audience: public
---

**Editor and forum failures are kept against their Error ID.** The document editor Worker hands each failure it logs to the API Worker's new named entrypoint `ErrorRecordIntake` (`apps/api-worker/src/system-status/error-record-intake.ts`) over the `ERROR_RECORD` service binding (`apps/edit-worker/src/failure-handoff.ts`), so the editor still holds no database. The community forum Worker, which already binds the control-plane database, writes its failures there directly (`apps/community-worker/src/failure-record.ts`). Both build the row with `errorRecordFromFailureEvent` in `@magna-carta/data-access/error-record-statements`, which the API Worker's own background tap now uses too, and the telemetry tap is now handed `error.captured` as well as `operation.failed`. The other Workers log no failures of their own: the API Worker that calls them logs and records the failure. Recent Errors now needs the Workers Logs token only for a failure the record could not take.

## Public

An Error ID shown by the document editor or the community forum can now be looked up in System Status, and those failures appear in Recent Errors without any setup.
