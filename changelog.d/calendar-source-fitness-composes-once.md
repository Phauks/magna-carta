---
category: Fixed
audience: internal
---

**The calendar source-fitness pass stopped re-migrating a database per assertion.**
`packages/calendar/test/source-fitness.test.ts` built a fresh in-memory per-firm database inside
`statementsFor`, so every one of roughly seventy-five statement compositions re-read the committed
migrations off disk and replayed the whole schema — fourteen seconds of DDL to prove properties
about composed SQL text, none of which is ever executed. One migrated handle now serves the file,
matching `test/visibility-fitness.test.ts` and `test/load-profile.test.ts`; the file's test time
falls from 14.65 s to 50 ms across the same 64 assertions. This is what made the pass time out at
the 5 s default on branches that never touched the calendar: under CPU contention a case doing real
work gets starved, and the red run then names the wrong subsystem.
