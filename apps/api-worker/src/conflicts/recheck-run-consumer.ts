import { satisfyRecheckRequestsForMatter } from "@magna-carta/conflicts/recheck-run";
import {
  countOpenRecheckRequests,
  readMattersAwaitingRecheck,
} from "@magna-carta/conflicts/recheck-statements";
import type { Logger } from "@magna-carta/telemetry/logger";
import type { Bindings } from "../bindings.ts";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";
import { automatedConflictsContext } from "./recheck-context.ts";

// THE RUN CONSUMER: one matter per message, every cause open against it coalesced into ONE check that
// names them all, and each claimed request stamped with the check that answered it.
//
// It must not import the disposition module. An automated path that could record a conclusion would
// be a conclusion nobody made, and the record's entire value is that a live person's name is on every
// one. A source-scan fitness function fails the build if the import appears here, and — belt and
// braces, because a rule that survives review dies in a refactor — the database refuses a disposition
// whose reviewer is not a live member.
//
// BUDGETS BOUND THE INVOCATION, NEVER THE WORK. Exceeding one leaves requests open, which is a
// visible state the posture read reports; it never discards a cause.

// Wall-clock ceiling for one drain pass. A matter already in flight when the budget runs out is
// finished — abandoning a check midway would leave its causes open AND its check written, which reads
// as a search that answered nothing.
const DRAIN_WALL_CLOCK_BUDGET_MILLISECONDS = 20_000;

// How many matters one cron drain pass takes on. The queue path handles one matter per message and
// ignores this.
const DRAIN_MATTERS_PER_PASS = 10;

export interface RecheckRunMessage {
  readonly matterId: string;
}

// Parses the drain signal. The payload carries the matter and nothing else on purpose: the run
// re-reads that matter's open ledger rows, so a message that arrives twice, late, or after the cron
// backstop already drained the matter resolves to the truth in the table rather than to whatever was
// true when the message was written.
export function parseRecheckRunPayload(payload: string): RecheckRunMessage | null {
  try {
    const parsed: unknown = JSON.parse(payload);
    if (typeof parsed !== "object" || parsed === null) return null;
    const matterId = (parsed as Record<string, unknown>)["matterId"];
    return typeof matterId === "string" && matterId.length > 0 ? { matterId } : null;
  } catch {
    return null;
  }
}

export async function consumeRecheckRun(
  env: Bindings,
  firmId: string,
  firmDatabase: ProxyBatchDatabase,
  payload: string,
  logger: Logger,
): Promise<void> {
  const message = parseRecheckRunPayload(payload);
  if (message === null) {
    logger.count("conflicts.recheck.malformed_cause", { topic: "conflicts.recheck.requested" }, 1);
    return;
  }

  const context = automatedConflictsContext(env, firmId, firmDatabase);
  const outcome = await satisfyRecheckRequestsForMatter(context, message.matterId, {
    clock: context.clock,
    actorUserId: null,
    randomSource: context.randomSource,
  });
  if (outcome.checkId === null) {
    // Nothing was open by the time this ran — the backstop got there first, or this is a redelivery
    // of a signal already answered. Not a fault, and deliberately not a second check.
    logger.count("conflicts.recheck.already_satisfied", {}, 1);
    return;
  }
  logger.count("conflicts.recheck.satisfied", {}, outcome.causesSatisfied);
}

// THE CRON BACKSTOP. Drains what the queue did not: the matters with the oldest unsatisfied causes,
// oldest first, under both budgets. A producer that was never wired, a fan-out that outran one relay
// cycle, a queue message lost to a dead-letter — all of them end up here, which is the point. A
// procedure with no backstop is a procedure that fails silently.
export async function drainRecheckLedger(
  env: Bindings,
  firmId: string,
  firmDatabase: ProxyBatchDatabase,
  logger: Logger,
): Promise<number> {
  const matterIds = await readMattersAwaitingRecheck(firmDatabase, DRAIN_MATTERS_PER_PASS);
  if (matterIds.length === 0) return 0;

  const context = automatedConflictsContext(env, firmId, firmDatabase);
  const startedAt = Date.now();
  let satisfied = 0;
  for (const matterId of matterIds) {
    if (Date.now() - startedAt > DRAIN_WALL_CLOCK_BUDGET_MILLISECONDS) {
      // Out of budget. The remaining requests stay open and the posture read goes on reporting them,
      // so a firm that is falling behind can see that it is. The next pass picks up where this
      // stopped, still oldest first.
      logger.count("conflicts.recheck.drain_budget_exhausted", {}, 1);
      break;
    }
    const outcome = await satisfyRecheckRequestsForMatter(context, matterId, {
      clock: context.clock,
      actorUserId: null,
      randomSource: context.randomSource,
    });
    satisfied += outcome.causesSatisfied;
  }
  if (satisfied > 0) logger.count("conflicts.recheck.satisfied", {}, satisfied);
  // What is still owed after this pass. The rate is the alertable signal — a backlog that only grows
  // means the firm's screening is falling behind its own records, which is the one thing the ledger
  // cannot fix by itself, and it is invisible from the satisfied count alone. Read after the drain so
  // the number is what a reader would see if they asked now.
  logger.count("conflicts.recheck.open_backlog", {}, await countOpenRecheckRequests(firmDatabase));
  return satisfied;
}
