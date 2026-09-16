import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { commitEffectBatch, type BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { MatterId, MatterTaskId, UserId } from "@magna-carta/identifiers/types";
import {
  archiveMatterTask,
  moveMatterTaskToRung,
  createMatterTask,
} from "@magna-carta/tasks/task-service";
import { captureTimeEntry } from "@magna-carta/timekeeping/time-entry-service";
import type { FixtureContext } from "../context.ts";
import { assertSeedingAllowed, type SeedingOptions } from "../guard.ts";
import type { TaskVolume } from "./profile.ts";

// The task volume laid over the practice book. Every row rides the REAL write path —
// createMatterTask, then captureTimeEntry for the linked time — so the corpus obeys the rules the
// subsystem enforces: no due date is computed from another date, a task on no matter is genuinely
// matterless, and a time entry's task is on that entry's own matter because the service refuses
// anything else.
//
// What this generator is really shaping is the two things every task read shares and nothing else
// in the fixture set exercises:
//
//   THE THREE-TERM ORDER — undated last, then by date, then by priority rank, then by identifier.
//   A corpus that were all dated, or all one priority, would let a regression reorder the list
//   without any measurement noticing, because there would be no ties for the later terms to break.
//
//   THE ONE VISIBILITY FRAGMENT, whose nullable-matter branch only exists because some tasks have
//   no matter at all. Generate none of those and that branch is measured doing nothing.

const MILLISECONDS_PER_DAY = 86_400_000;

const TASK_TITLES = [
  "Draft the demand letter",
  "Call the client back",
  "File the answer",
  "Review the medical records",
  "Prepare the deposition outline",
  "Serve the subpoena",
  "Update the case chronology",
  "Order the transcript",
  "Confirm the hearing date",
  "Send the engagement letter",
] as const;

// The firm's own work: real obligations with nobody's matter behind them. This is the population
// the nullable-matter branch exists for.
const FIRM_WORK_TITLES = [
  "Renew the malpractice policy",
  "Interview the paralegal candidate",
  "Reconcile the trust account",
  "Update the conflicts questionnaire",
  "Book the bar-association CLE",
  "Replace the scanner in the file room",
] as const;

const PRIORITIES = ["urgent", "high", "normal", "low"] as const;

export interface TaskProbes {
  // The matter whose task list is deepest — the page-1-versus-page-20 target.
  readonly deepTaskMatterId: MatterId;
  // The member the participant-filtered reads resolve through, and whose own matterless work is
  // reachable only to them.
  readonly memberUserId: UserId;
  // One task with time logged against it, for the single-task spelling of the grouped read.
  readonly timeLinkedTaskId: MatterTaskId;
  // A page's worth of task identifiers from the deep matter, so the grouped time read is measured
  // fanning over exactly what a rendered page would ask about — the shape an N+1 would hide in.
  readonly pageTaskIds: readonly MatterTaskId[];
  // A word that appears in some titles and not others, so the search read is selective rather than
  // matching everything or nothing.
  readonly searchTerm: string;
  // The civil date the overdue comparison is taken against. Recorded rather than read from a clock
  // in the measurement layer, so the plan probes and the timings bind the same day.
  readonly readAtDate: string;
}

export interface TaskGenerationResult {
  readonly taskCount: number;
  readonly matterlessTaskCount: number;
  readonly taskTimeEntryCount: number;
  readonly probes: TaskProbes;
}

export interface TaskAttachPoints {
  readonly matterIds: readonly MatterId[];
  // The matter the other generators already made busiest — the deep-list probe.
  readonly deepTaskMatterId: MatterId;
  readonly memberUserId: UserId;
  // A second member, so "somebody else's task" is a real shape the participant filter skips past.
  readonly otherMemberUserId: UserId;
}

function civilDateOffsetBy(baseDate: string, days: number): string {
  return new Date(Date.parse(`${baseDate}T00:00:00.000Z`) + days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

export async function generateTaskVolume(
  database: BatchDatabase,
  context: FixtureContext,
  volume: TaskVolume,
  attach: TaskAttachPoints,
  options: SeedingOptions,
): Promise<TaskGenerationResult> {
  assertSeedingAllowed(options);
  const { faker, clock, randomSource } = context;
  const serviceOptions = {
    clock,
    actorUserId: attach.memberUserId,
    randomSource,
    // The seam every task read composes. Generation uses the same predicate the product does, so
    // a task this generator writes onto an invisible matter would be invisible here too.
    visibility: visibleMatterPredicate(),
  };
  const commit = (effect: Parameters<typeof commitEffectBatch>[1]) =>
    commitEffectBatch(database, effect, { now: () => clock.now() });

  if (attach.matterIds.length === 0) {
    throw new Error("load-profile: task volume needs at least one matter to hang tasks off");
  }

  const readAtDate = clock.now().slice(0, 10);
  // Half the span behind the clock and half ahead, so the read-time overdue comparison has rows on
  // both sides of it rather than a corpus that is entirely past or entirely future.
  const halfSpan = Math.max(1, Math.floor(volume.spanDays / 2));

  let taskCount = 0;
  let matterlessTaskCount = 0;
  let taskTimeEntryCount = 0;
  const deepMatterTaskIds: MatterTaskId[] = [];
  // Tasks eligible to be a predecessor, kept per matter: the link is refused across matters, and a
  // blocked task pointing at another matter's work would be a row the product cannot produce.
  const previousOnMatter = new Map<string, MatterTaskId>();
  const timeLinked: { taskId: MatterTaskId; matterId: MatterId }[] = [];

  async function writeTask(matterId: MatterId | null, deep: boolean): Promise<MatterTaskId> {
    // WHERE THE TASK ENDS UP. The open share is spread across the three open rungs, because a
    // corpus where every unfinished task sits on To Do would measure a list nobody has worked.
    // The remainder is archived — the disposal that keeps the row, so it still costs a read the
    // filter has to exclude, which is the part worth measuring.
    const resting = faker.helpers.weightedArrayElement([
      { value: "to_do" as const, weight: Math.round(volume.openFraction * 60) },
      { value: "in_progress" as const, weight: Math.round(volume.openFraction * 30) },
      { value: "on_hold" as const, weight: Math.round(volume.openFraction * 10) },
      { value: "done" as const, weight: Math.round(volume.doneFraction * 100) },
      {
        value: "archived" as const,
        weight: Math.max(1, Math.round((1 - volume.openFraction - volume.doneFraction) * 100)),
      },
    ]);
    const dated = faker.number.float({ min: 0, max: 1 }) < volume.datedFraction;
    const overdue = dated && faker.number.float({ min: 0, max: 1 }) < volume.overdueFraction;
    const dueOn = dated
      ? civilDateOffsetBy(
          readAtDate,
          overdue
            ? -faker.number.int({ min: 1, max: halfSpan })
            : faker.number.int({ min: 0, max: halfSpan }),
        )
      : null;
    const assigned = faker.number.float({ min: 0, max: 1 }) < volume.assignedFraction;
    const participantsFor = (named: boolean) => {
      if (!named) return [];
      const doer = faker.helpers.arrayElement([attach.memberUserId, attach.otherMemberUserId]);
      const watcher = doer === attach.memberUserId ? attach.otherMemberUserId : attach.memberUserId;
      return faker.number.float({ min: 0, max: 1 }) < 0.3
        ? [
            { userId: doer, role: "assigned" as const },
            { userId: watcher, role: "watcher" as const },
          ]
        : [{ userId: doer, role: "assigned" as const }];
    };
    const blockedBy =
      matterId !== null && faker.number.float({ min: 0, max: 1 }) < volume.blockedFraction
        ? (previousOnMatter.get(matterId) ?? null)
        : null;

    const created = await createMatterTask(
      database,
      {
        matterId,
        title: faker.helpers.arrayElement(matterId === null ? FIRM_WORK_TITLES : TASK_TITLES),
        body: null,
        priority: faker.helpers.arrayElement(PRIORITIES),
        // A matterless task is private to the people on it and whoever created it, so the firm's
        // own work always names somebody — one nobody is on would be reachable to its creator alone
        // and would measure a narrower read than the branch is for. Some tasks also carry a
        // watcher, so the participant table holds more than one role and the "mine" filter has a
        // non-work role to include.
        participants: participantsFor(matterId === null || assigned),
        dueOn,
        // The zone travels with the date or not at all: "Friday" falls at two moments in Reno and
        // Boston, and a date with no zone is a date nothing can resolve.
        timeZone: dueOn === null ? null : "America/Los_Angeles",
        blockedByTaskId: blockedBy,
      },
      serviceOptions,
    );
    await commit(created.effect);
    taskCount += 1;
    if (matterId === null) matterlessTaskCount += 1;
    if (matterId !== null) previousOnMatter.set(matterId, created.taskId);
    if (deep) deepMatterTaskIds.push(created.taskId);

    // A rung a task rests on and an archiving are both things a person did to it, so the corpus
    // takes it there through the same writes the product does rather than by setting the columns.
    if (resting === "archived") {
      const archived = await archiveMatterTask(
        database,
        created.taskId,
        "Overtaken by the settlement",
        serviceOptions,
      );
      await commit(archived.effect);
    } else if (resting !== "to_do") {
      const moved = await moveMatterTaskToRung(database, created.taskId, resting, serviceOptions);
      await commit(moved.effect);
    }

    if (matterId !== null && faker.number.float({ min: 0, max: 1 }) < volume.timeLinkedFraction) {
      timeLinked.push({ taskId: created.taskId, matterId });
    }
    return created.taskId;
  }

  for (const matterId of attach.matterIds) {
    const count =
      matterId === attach.deepTaskMatterId
        ? volume.probeMatterTaskCount
        : faker.number.int(volume.tasksPerMatter);
    for (let index = 0; index < count; index += 1) {
      await writeTask(matterId, matterId === attach.deepTaskMatterId);
    }
  }

  for (let index = 0; index < volume.matterlessTaskCount; index += 1) {
    await writeTask(null, false);
  }

  // The time against those tasks, captured through the real path — which is also the assertion that
  // every link this corpus holds is one the service would accept, since it refuses a task on any
  // matter but the entry's own.
  for (const link of timeLinked) {
    const entries = faker.number.int(volume.timeEntriesPerLinkedTask);
    for (let index = 0; index < entries; index += 1) {
      const captured = await captureTimeEntry(
        database,
        {
          matterId: link.matterId,
          timekeeperUserId: faker.helpers.arrayElement([
            attach.memberUserId,
            attach.otherMemberUserId,
          ]),
          workDate: civilDateOffsetBy(readAtDate, -faker.number.int({ min: 0, max: halfSpan })),
          rawDurationMinutes: faker.number.int({ min: 6, max: 240 }),
          durationMinutes: faker.number.int({ min: 6, max: 240 }),
          narrative: "Work on the task",
          billable: true,
          source: "manual",
          currency: "USD",
          rate: { noRate: true },
          taskId: link.taskId,
        },
        serviceOptions,
      );
      await commit(captured.effect);
      taskTimeEntryCount += 1;
    }
  }

  const timeLinkedTaskId = timeLinked[0]?.taskId ?? deepMatterTaskIds[0];
  if (timeLinkedTaskId === undefined) {
    throw new Error("load-profile: task volume produced no task to probe");
  }

  return {
    taskCount,
    matterlessTaskCount,
    taskTimeEntryCount,
    probes: {
      deepTaskMatterId: attach.deepTaskMatterId,
      memberUserId: attach.memberUserId,
      timeLinkedTaskId,
      // One rendered page's worth, which is what the grouped time read actually fans over.
      pageTaskIds: deepMatterTaskIds.slice(0, 50),
      // A word in some of the titles above and not others. The search read is a LIKE scan bounded
      // by a narrowing, so a term matching everything would measure the bound doing nothing.
      searchTerm: "deposition",
      readAtDate,
    },
  };
}
