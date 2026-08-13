import { newIdentifier } from "@magna-carta/identifiers/generate";
import type { ConflictsRecheckRequestId } from "@magna-carta/identifiers/types";
import { expect, test } from "vitest";
import { recordRecheckRequests } from "../src/recheck-request.ts";
import {
  countOpenRecheckRequests,
  insertRecheckRequestStatement,
  markRecheckRequestSatisfiedStatement,
  readMattersAwaitingRecheck,
  readOpenRecheckRequestsForMatter,
} from "../src/recheck-statements.ts";
import { CONFLICTS_RECHECK_REQUESTED_TOPIC } from "../src/topics.ts";
import { recheckFixture } from "./support/recheck-fixture.ts";

// THE LEDGER'S THREE STRUCTURAL PROMISES, tested against the real triggers rather than against the
// statement builders that are supposed to respect them:
//
//   1. A redelivery is a no-op while a request is open, and the SAME cause recurring after the
//      request was answered is a fresh request.
//   2. A recorded cause cannot be rewritten. The row is what shows the firm's procedure noticed
//      something, and a record that can be edited afterwards is not evidence of anything.
//   3. A row is never deleted, and a satisfaction never reopens.

const CAUSE_TOPIC = "directory.entity.merged";
const OCCURRED = "2026-08-13T08:00:00.000Z";

test("a redelivered cause writes no second open row, and a recurrence after satisfaction does", async () => {
  const fixture = await recheckFixture("dedup");
  fixture.addMatter("matter_one");

  const write = (): Promise<unknown> =>
    recordRecheckRequests(
      fixture.database,
      {
        causeTopic: CAUSE_TOPIC,
        causeReference: "directoryPerson_subordinate",
        causeOccurredAt: OCCURRED,
        matterIds: ["matter_one"],
        maxMattersPerEvent: 50,
      },
      { now: fixture.clock.now, randomSource: fixture.randomSource },
    );

  await write();
  await write();
  expect(await countOpenRecheckRequests(fixture.database)).toBe(1);

  // Answer it, then let the same cause recur. The satisfied row has left the partial index, so the
  // recurrence is recorded rather than swallowed — which is the behaviour a genuinely recurring
  // cause needs, and the reason the index is partial rather than total.
  const open = await readOpenRecheckRequestsForMatter(fixture.database, "matter_one", 10);
  const checkId = newIdentifier("conflictsCheck", fixture.randomSource);
  fixture.raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) ` +
      `VALUES ('${checkId}', 'entity_merged', 'matter_one', '[]', '{}', 'balanced', 1, '{}', 0, NULL, '${OCCURRED}')`,
  );
  await fixture.database.batch([
    markRecheckRequestSatisfiedStatement(fixture.database, {
      id: open[0]!.id,
      checkId,
      satisfiedAt: "2026-08-13T09:00:00.000Z",
    }),
  ]);
  expect(await countOpenRecheckRequests(fixture.database)).toBe(0);

  await write();
  expect(await countOpenRecheckRequests(fixture.database)).toBe(1);
});

test("the recorded cause cannot be rewritten after the fact", async () => {
  const fixture = await recheckFixture("immutable-cause");
  fixture.addMatter("matter_one");
  await recordRecheckRequests(
    fixture.database,
    {
      causeTopic: CAUSE_TOPIC,
      causeReference: "directoryPerson_subordinate",
      causeOccurredAt: OCCURRED,
      matterIds: ["matter_one"],
      maxMattersPerEvent: 50,
    },
    { now: fixture.clock.now, randomSource: fixture.randomSource },
  );
  const [request] = await readOpenRecheckRequestsForMatter(fixture.database, "matter_one", 10);

  expect(() =>
    fixture.raw.exec(
      `UPDATE conflicts_recheck_request SET cause_reference = 'directoryPerson_other' WHERE id = '${request!.id}'`,
    ),
  ).toThrow(/records its cause once/);
  expect(() =>
    fixture.raw.exec(
      `UPDATE conflicts_recheck_request SET cause_occurred_at = '2020-01-01T00:00:00.000Z' WHERE id = '${request!.id}'`,
    ),
  ).toThrow(/records its cause once/);
  expect(() =>
    fixture.raw.exec(`DELETE FROM conflicts_recheck_request WHERE id = '${request!.id}'`),
  ).toThrow(/never deleted/);
});

test("a satisfaction is final — nothing reopens an answered request", async () => {
  const fixture = await recheckFixture("final");
  fixture.addMatter("matter_one");
  const requestId = newIdentifier("conflictsRecheckRequest", fixture.randomSource);
  await fixture.database.batch([
    insertRecheckRequestStatement(fixture.database, {
      id: requestId as ConflictsRecheckRequestId,
      matterId: "matter_one",
      causeTopic: CAUSE_TOPIC,
      causeReference: "directoryPerson_subordinate",
      causeOccurredAt: OCCURRED,
      requestedAt: OCCURRED,
    }),
  ]);
  const checkId = newIdentifier("conflictsCheck", fixture.randomSource);
  fixture.raw.exec(
    `INSERT INTO conflicts_check (id, trigger, subject_matter_id, subject_parties_json, scope_json, strictness, depth, inputs_json, floor_raised, actor_user_id, created_at) ` +
      `VALUES ('${checkId}', 'entity_merged', 'matter_one', '[]', '{}', 'balanced', 1, '{}', 0, NULL, '${OCCURRED}')`,
  );
  fixture.raw.exec(
    `UPDATE conflicts_recheck_request SET satisfied_by_check_id = '${checkId}', satisfied_at = '2026-08-13T09:00:00.000Z' WHERE id = '${requestId}'`,
  );

  // Reopening would detach the recorded interval from the check that closed it, and the interval is
  // the whole reason the row is kept after it has been answered.
  expect(() =>
    fixture.raw.exec(
      `UPDATE conflicts_recheck_request SET satisfied_at = NULL, satisfied_by_check_id = NULL WHERE id = '${requestId}'`,
    ),
  ).toThrow(/is final/);
});

test("a fan-out past the queue cap still writes every row; only the queue messages are capped", async () => {
  const fixture = await recheckFixture("fanout");
  for (let index = 0; index < 12; index += 1) {
    fixture.addMatter(`matter_${String(index).padStart(2, "0")}`);
  }

  const result = await recordRecheckRequests(
    fixture.database,
    {
      causeTopic: CAUSE_TOPIC,
      causeReference: "directoryPerson_subordinate",
      causeOccurredAt: OCCURRED,
      matterIds: Array.from(
        { length: 12 },
        (_, index) => `matter_${String(index).padStart(2, "0")}`,
      ),
      maxMattersPerEvent: 3,
    },
    { now: fixture.clock.now, randomSource: fixture.randomSource },
  );

  // Every affected matter has its row. A cap on ROWS would be a cause the platform noticed and then
  // forgot, which is exactly the failure the ledger exists to make impossible.
  expect(result.mattersAffected).toBe(12);
  expect(await countOpenRecheckRequests(fixture.database)).toBe(12);
  // Only three ride the queue now; the rest wait for the cron backstop, which drains oldest first.
  expect(result.mattersQueued).toBe(3);
  const { results } = await fixture.database
    .prepare("SELECT COUNT(*) AS total FROM outbox WHERE topic = ?1")
    .bind(CONFLICTS_RECHECK_REQUESTED_TOPIC)
    .all<{ total: number }>();
  expect(results[0]?.total).toBe(3);
  // And the backstop can see all twelve, oldest cause first.
  expect(await readMattersAwaitingRecheck(fixture.database, 100)).toHaveLength(12);
});
