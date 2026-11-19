---
category: Added
audience: public
---

**A Change Log report.** `GET /api/v1/reports/change-log` (`reports:operational`, over a period of UTC days) counts who added, changed and removed people and organizations, matters and the trust approval rule, by kind of record and by person, and lists every change newest first: when, who, a plain-words label, and the record's handle. It never prints an audit row's metadata. The rows are the per-firm audit log's, read through `readAuditChanges` beside the audit write in `packages/data-access/src/audit-statements.ts`; the event vocabulary is `CHANGE_LOG_EVENTS` in `packages/reporting/src/operational/change-log.ts`. The audit log is append-only and its instant is both when a change happened and when it was recorded, so the report takes no knowledge instant and says whether its period had ended. `packages/reporting/test/operational-change-log.test.ts` proves the families and the people add up to the period's audit rows, and that every covered event is still written by its package. Opening a trust account, adding a ledger account and mapping billing account roles write no audit row today, so the Accounts count holds the trust approval rule alone.

## Public

A new Change Log report shows who changed people, organizations, matters and trust account rules, and when.
