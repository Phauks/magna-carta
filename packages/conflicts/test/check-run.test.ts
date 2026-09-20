import { commitEffectBatch } from "@magna-carta/data-access/effect-batch";
import { createPerson } from "@magna-carta/directory/person";
import { setActiveNumberingScheme } from "@magna-carta/sequence-numbering/scheme-service";
import { expect, test } from "vitest";
import {
  executeCheckRun,
  runConflictsCheck,
  RUN_FAILURE,
  type RunCheckInput,
} from "../src/run-check.ts";
import {
  fileCheckOnMatterStatement,
  openCheckRun,
  parseRunProgress,
  readNumberedCheck,
  readNumberedCheckByAnyId,
  readRun,
  readRunsForCheck,
  previewNextCheckNumber,
  runIsStale,
  settleStaleRuns,
  STALE_RUN_AFTER_MILLISECONDS,
  STALE_RUN_FAILURE,
  UnknownNumberedCheckError,
  type CheckRunRow,
  type StoredRunRequest,
} from "../src/check-run.ts";
import {
  selectConflictsChecksStatement,
  type ConflictsCheckSummaryRow,
} from "../src/statements.ts";
import { readMatterConflictsPosture } from "../src/posture.ts";
import { recheckFixture, type RecheckFixture } from "./support/recheck-fixture.ts";

// The check a person refers to, and the runs under it. What is worth a test is the lifecycle: a run
// is opened before the search and settled with its record, a re-run belongs to the same check, an
// automated re-check of a matter lands under the matter's check, a run that stops reporting is
// settled as failed by the read, and the number is the one a person says out loud.

const MATTER = "matter_alpha";

function request(over: Partial<RunCheckInput> = {}): RunCheckInput {
  return {
    trigger: "preliminary",
    subjectEntityIds: [],
    scope: { sources: ["party"], strictness: "balanced" },
    triggerSource: "manual",
    ...over,
  };
}

// The search as a run stores it: the same facts, with the matter spelled as null rather than absent.
function storedRequest(over: Partial<StoredRunRequest> = {}): StoredRunRequest {
  return {
    trigger: "preliminary",
    matterId: null,
    subjectEntityIds: [],
    scope: { sources: ["party"], strictness: "balanced" },
    ...over,
  };
}

async function subjectOn(fixture: RecheckFixture, seed: string): Promise<string> {
  return createPerson(
    fixture.database,
    { given: seed, family: "Subject" },
    { ...fixture.writeOptions },
  );
}

test("the check number is drawn from the firm's scheme: the built-in default restarts each year, and a configured scheme is honoured", async () => {
  const fixture = await recheckFixture("check-number-scheme");
  // Nothing configured: the register's default, with the year the check was opened in.
  expect(await previewNextCheckNumber(fixture.database, fixture.writeOptions.clock.now())).toBe(
    "CC2026-00001",
  );
  expect(await previewNextCheckNumber(fixture.database, "2027-03-01T09:00:00.000Z")).toBe(
    "CC2027-00001",
  );
  // The firm writes its own shape on the numbering screen, and the next check wears it.
  const { effect } = setActiveNumberingScheme(
    fixture.database,
    [
      { kind: "literal", text: "CONF-" },
      { kind: "counter", padWidth: 3, start: 100 },
    ],
    { clock: fixture.writeOptions.clock, actorUserId: fixture.writeOptions.actorUserId },
    "conflicts_check",
  );
  await commitEffectBatch(fixture.database, effect, {
    now: fixture.writeOptions.clock.now,
  });
  expect(await previewNextCheckNumber(fixture.database, fixture.writeOptions.clock.now())).toBe(
    "CONF-100",
  );
  const opened = await openCheckRun(
    fixture.database,
    { request: storedRequest(), triggerSource: "manual", under: null },
    fixture.writeOptions,
  );
  expect(opened.checkNumber).toBe("CONF-100");
  expect(await previewNextCheckNumber(fixture.database, fixture.writeOptions.clock.now())).toBe(
    "CONF-101",
  );
});

test("a run is opened queued with the search it will perform, then settled completed with its record", async () => {
  const fixture = await recheckFixture("open-and-execute");
  const subject = await subjectOn(fixture, "Opened");
  const input = request({ subjectEntityIds: [subject] });

  const opened = await openCheckRun(
    fixture.database,
    { request: { ...input, matterId: null }, triggerSource: "manual", under: null },
    fixture.writeOptions,
  );
  expect(opened.checkNumber).toBe("CC2026-00001");
  expect(opened.ordinal).toBe(1);
  // A check is identified by its first run's handle.
  expect(opened.runId).toBe(opened.numberedCheckId);

  const queued = await readRun(fixture.database, opened.runId);
  expect(queued?.status).toBe("queued");
  expect(JSON.parse(queued!.request_json)).toMatchObject({ subjectEntityIds: [subject] });

  const executed = await executeCheckRun(
    fixture.context,
    { runId: opened.runId, input },
    fixture.writeOptions,
  );
  expect(executed).toBe(opened.runId);

  const settled = await readRun(fixture.database, opened.runId);
  expect(settled?.status).toBe("completed");
  expect(settled?.stage).toBeNull();
  expect(settled?.finished_at).not.toBeNull();
  // The record exists under the run's own handle.
  const { results } = await fixture.database
    .prepare(`SELECT id FROM conflicts_check WHERE id = ?1`)
    .bind(opened.runId)
    .all<{ id: string }>();
  expect(results).toHaveLength(1);

  // A second executor finds nothing to claim and searches nothing.
  const again = await executeCheckRun(
    fixture.context,
    { runId: opened.runId, input },
    fixture.writeOptions,
  );
  expect(again).toBeNull();
});

test("a re-run opens under the same check with the next ordinal, and the check's latest run moves", async () => {
  const fixture = await recheckFixture("re-run");
  const subject = await subjectOn(fixture, "Rerun");
  const first = await runConflictsCheck(
    fixture.context,
    request({ subjectEntityIds: [subject] }),
    fixture.writeOptions,
  );

  const second = await openCheckRun(
    fixture.database,
    {
      request: storedRequest({ subjectEntityIds: [subject] }),
      triggerSource: "manual",
      under: { numberedCheckId: first },
    },
    fixture.writeOptions,
  );
  expect(second.numberedCheckId).toBe(first);
  expect(second.runId).not.toBe(first);
  expect(second.ordinal).toBe(2);
  expect(second.checkNumber).toBe("CC2026-00001");

  const runs = await readRunsForCheck(fixture.database, first);
  expect(runs.map((run) => run.ordinal)).toEqual([1, 2]);
  expect((await readNumberedCheck(fixture.database, first))?.latest_run_id).toBe(second.runId);
  // Either handle finds the check.
  expect((await readNumberedCheckByAnyId(fixture.database, second.runId))?.id).toBe(first);
});

test("a re-run of a check nobody has opened is refused by name", async () => {
  const fixture = await recheckFixture("unknown");
  await expect(
    openCheckRun(
      fixture.database,
      {
        request: storedRequest(),
        triggerSource: "manual",
        under: { numberedCheckId: "conflictsCheck_nobody" as never },
      },
      fixture.writeOptions,
    ),
  ).rejects.toBeInstanceOf(UnknownNumberedCheckError);
});

test("checks draw consecutive numbers, and the log lists one row per check with its run count", async () => {
  const fixture = await recheckFixture("sequence");
  fixture.addMatter(MATTER);
  const subject = await subjectOn(fixture, "Sequenced");
  const first = await runConflictsCheck(
    fixture.context,
    request({ subjectEntityIds: [subject] }),
    fixture.writeOptions,
  );
  const second = await runConflictsCheck(
    fixture.context,
    request({ subjectEntityIds: [subject], matterId: MATTER, trigger: "comprehensive" }),
    fixture.writeOptions,
  );
  // A further run on the matter lands under the matter's check rather than as a third row.
  const third = await runConflictsCheck(
    fixture.context,
    request({
      subjectEntityIds: [],
      matterId: MATTER,
      trigger: "new_party",
      triggerSource: "event",
    }),
    { ...fixture.writeOptions, actorUserId: null as never },
  );
  expect(third).not.toBe(second);
  expect((await readNumberedCheckByAnyId(fixture.database, third))?.id).toBe(second);

  const { results } = await selectConflictsChecksStatement(fixture.database, {
    limit: 10,
  }).all<ConflictsCheckSummaryRow>();
  expect(results.map((row) => row.check_number)).toEqual(["CC2026-00002", "CC2026-00001"]);
  const matterRow = results.find((row) => row.id === second);
  expect(matterRow?.run_count).toBe(2);
  expect(matterRow?.latest_run_id).toBe(third);
  expect(matterRow?.run_status).toBe("completed");
  expect(matterRow?.trigger).toBe("new_party");
  expect(matterRow?.hit_count).toBe(0);
  expect(results.find((row) => row.id === first)?.run_count).toBe(1);

  const narrowed = await selectConflictsChecksStatement(fixture.database, {
    matterId: MATTER,
    limit: 10,
  }).all<ConflictsCheckSummaryRow>();
  expect(narrowed.results.map((row) => row.id)).toEqual([second]);
});

test("filing a check on a matter later makes it the matter's own, without touching the search record", async () => {
  const fixture = await recheckFixture("file-later");
  fixture.addMatter(MATTER);
  const subject = await subjectOn(fixture, "Filed");
  const checkId = await runConflictsCheck(
    fixture.context,
    request({ subjectEntityIds: [subject] }),
    fixture.writeOptions,
  );

  const before = await readMatterConflictsPosture(fixture.database, MATTER);
  expect(before.neverChecked).toBe(true);

  await fileCheckOnMatterStatement(fixture.database, checkId, MATTER, fixture.clock.now()).run();

  const after = await readMatterConflictsPosture(fixture.database, MATTER);
  expect(after.neverChecked).toBe(false);
  expect(after.latestCheck?.id).toBe(checkId);
  expect(after.latestCheck?.checkNumber).toBe("CC2026-00001");
  // The record still says which matter the search actually ran against: none.
  const { results } = await fixture.database
    .prepare(`SELECT subject_matter_id FROM conflicts_check WHERE id = ?1`)
    .bind(checkId)
    .all<{ subject_matter_id: string | null }>();
  expect(results[0]?.subject_matter_id).toBeNull();
  // And a further run lands under the filed check, now against the matter.
  const rerun = await openCheckRun(
    fixture.database,
    {
      request: storedRequest({ subjectEntityIds: [subject] }),
      triggerSource: "manual",
      under: { numberedCheckId: checkId },
    },
    fixture.writeOptions,
  );
  expect(JSON.parse((await readRun(fixture.database, rerun.runId))!.request_json)).toMatchObject({
    matterId: MATTER,
  });
});

test("a search that throws settles its run as failed with a sentence a person can act on", async () => {
  const fixture = await recheckFixture("failure");
  const opened = await openCheckRun(
    fixture.database,
    { request: storedRequest(), triggerSource: "manual", under: null },
    fixture.writeOptions,
  );
  // A context whose database refuses every read: the search cannot even resolve the firm's policy.
  const broken = {
    ...fixture.context,
    database: {
      prepare: (sql: string) => {
        if (sql.startsWith("UPDATE conflicts_check_run")) return fixture.database.prepare(sql);
        throw new Error("the database is unreachable");
      },
      batch: fixture.database.batch.bind(fixture.database),
      // Mirrored, not asserted: this observer stands in for the real database, and a stand-in that
      // drops the capability commits every guarded write unguarded. commitEffectBatch refuses that
      // outright, which is how this wrapper was found rather than quietly weakening the run.
      enforcesGuardedWrites: fixture.database.enforcesGuardedWrites,
    } as never,
  };
  await expect(
    executeCheckRun(broken, { runId: opened.runId, input: request() }, fixture.writeOptions),
  ).rejects.toThrow("unreachable");
  const failed = await readRun(fixture.database, opened.runId);
  expect(failed?.status).toBe("failed");
  expect(failed?.failure).toBe(RUN_FAILURE);
});

test("a run that stops reporting is settled as failed by whoever reads it", async () => {
  const fixture = await recheckFixture("stale");
  const opened = await openCheckRun(
    fixture.database,
    { request: storedRequest(), triggerSource: "manual", under: null },
    fixture.writeOptions,
  );
  const startedAt = fixture.clock.now();
  await fixture.database
    .prepare(
      `UPDATE conflicts_check_run SET status = 'running', started_at = ?2, heartbeat_at = ?2 WHERE id = ?1`,
    )
    .bind(opened.runId, startedAt)
    .run();
  const running = (await readRun(fixture.database, opened.runId)) as CheckRunRow;

  const soon = new Date(Date.parse(startedAt) + 1_000).toISOString();
  const later = new Date(Date.parse(startedAt) + STALE_RUN_AFTER_MILLISECONDS + 1).toISOString();
  expect(runIsStale(running, soon)).toBe(false);
  expect(runIsStale(running, later)).toBe(true);

  const stillRunning = await settleStaleRuns(fixture.database, [running], soon);
  expect(stillRunning[0]?.status).toBe("running");
  const settled = await settleStaleRuns(fixture.database, [running], later);
  expect(settled[0]?.status).toBe("failed");
  expect(settled[0]?.failure).toBe(STALE_RUN_FAILURE);
  expect((await readRun(fixture.database, opened.runId))?.status).toBe("failed");
});

test("progress is written onto the run in the engine's own order, and cleared when it settles", async () => {
  const fixture = await recheckFixture("progress");
  const subject = await subjectOn(fixture, "Progress");
  const stages: string[] = [];
  const observing = {
    ...fixture.context,
    database: {
      prepare: (sql: string) => {
        const statement = fixture.database.prepare(sql);
        if (!sql.includes("SET stage = ?2")) return statement;
        return {
          ...statement,
          bind: (...values: unknown[]) => {
            stages.push(String(values[1]));
            return statement.bind(...values);
          },
        };
      },
      batch: fixture.database.batch.bind(fixture.database),
      // Mirrored, not asserted: this observer stands in for the real database, and a stand-in that
      // drops the capability commits every guarded write unguarded. commitEffectBatch refuses that
      // outright, which is how this wrapper was found rather than quietly weakening the run.
      enforcesGuardedWrites: fixture.database.enforcesGuardedWrites,
    } as never,
  };
  const checkId = await runConflictsCheck(
    observing,
    request({
      subjectEntityIds: [subject],
      scope: { sources: ["party", "graph"], strictness: "balanced" },
    }),
    fixture.writeOptions,
  );
  expect([...new Set(stages)]).toEqual(["sources", "walking", "matching", "candidates"]);
  const settled = await readRun(fixture.database, checkId);
  expect(settled?.stage).toBeNull();
  expect(parseRunProgress(settled?.progress_json ?? null)).toEqual({});
});
