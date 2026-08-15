import type { DirectoryIdentifierContext } from "@magna-carta/directory/identifiers";
import type { ConflictsCheckId } from "@magna-carta/identifiers/types";
import type { ConflictsWriteOptions } from "./audit.ts";
import { triggerForCauseTopic } from "./recheck-cause.ts";
import {
  markRecheckRequestSatisfiedStatement,
  readOpenRecheckRequestsForMatter,
  type OpenRecheckRequestRow,
} from "./recheck-statements.ts";
import { runConflictsCheck } from "./run-check.ts";
import { readConflictsPolicy } from "./settings.ts";
import type { ConflictsCause, ConflictsTrigger } from "./types.ts";

// SATISFYING A MATTER'S OPEN RE-CHECK REQUESTS — claim, coalesce, run once, stamp.
//
// This module deliberately knows nothing about disposition. An automated path that could write a
// conclusion would be a conclusion nobody made, and the whole record's value is that every conclusion
// has a live person behind it. That is enforced twice: this module does not import disposition.ts,
// and a source scan fails the build if it or either worker consumer ever does.
//
// It is shared by the queue consumer and the cron backstop on purpose. Two drains that answered a
// matter differently would be two answers to the same question, and the second one would be
// invisible — the cron pass is the backstop for the queue, not an alternative to it.

// How many accumulated causes one coalesced check may name. A matter that has somehow accumulated
// more stays partly open — a visible state — rather than making a single invocation unbounded.
const MAXIMUM_CAUSES_PER_CHECK = 200;

export interface RecheckOutcome {
  readonly matterId: string;
  // Null when the matter had nothing open by the time this ran: the queue message arrived after the
  // cron backstop had already drained it, or a redelivery followed a run that already satisfied
  // everything. Neither is a fault, and neither writes a second check.
  readonly checkId: ConflictsCheckId | null;
  readonly causesSatisfied: number;
}

// The causes, in the shape the check row records them.
function causesFrom(requests: readonly OpenRecheckRequestRow[]): ConflictsCause[] {
  return requests.map((request) => ({
    topic: request.causeTopic,
    reference: request.causeReference,
    occurredAt: request.causeOccurredAt,
  }));
}

// The trigger ONE coalesced check records when it covers several different causes. The oldest cause
// names it: it is the change that has been waiting longest for an answer, and picking the newest
// would let a trivial later cause relabel a merge nobody had answered yet.
function triggerFor(requests: readonly OpenRecheckRequestRow[]): ConflictsTrigger {
  const oldest = requests[0];
  return oldest === undefined ? "periodic_rescan" : triggerForCauseTopic(oldest.causeTopic);
}

// Runs at most ONE check for one matter, covering every cause open against it, and stamps each
// claimed request with the check that answered it.
//
// The claim is a read rather than a lock: D1 has no interactive transactions, so two drains racing
// the same matter can both read the same open set. That is safe and deliberately not defended
// against — the second run writes a second, honest check over the same causes, and the satisfaction
// stamp is guarded on the row still being open, so the interval each request records still names the
// check that actually closed it. A duplicate check is a redundant search; a lost cause would be a
// missed conflict, and only one of those is worth engineering against.
export async function satisfyRecheckRequestsForMatter(
  context: DirectoryIdentifierContext,
  matterId: string,
  options: ConflictsWriteOptions,
): Promise<RecheckOutcome> {
  const open = await readOpenRecheckRequestsForMatter(
    context.database,
    matterId,
    MAXIMUM_CAUSES_PER_CHECK,
  );
  if (open.length === 0) return { matterId, checkId: null, causesSatisfied: 0 };

  // The firm's own floor decides what the automated run searches, exactly as it decides what a
  // requested one searches. An automated check that quietly searched less than a firm requires would
  // be the worst of both: a row in the log saying a check happened, and a search that did not.
  const policy = await readConflictsPolicy(context.database);

  const checkId = await runConflictsCheck(
    context,
    {
      trigger: triggerFor(open),
      matterId,
      // The matter's own live parties are the subjects; runConflictsCheck reads them. Nothing here
      // narrows the search to the entity the cause names — a merge changes what the whole matter's
      // party set matches, not only the merged record.
      subjectEntityIds: [],
      scope: { sources: policy.floorSources, strictness: policy.floorStrictness },
      triggerSource: "event",
      causes: causesFrom(open),
    },
    // No actor. An automated run is nobody's act, and attributing it to a person would put a name on
    // a search that person did not make.
    { ...options, actorUserId: null },
  );

  const satisfiedAt = options.clock.now();
  await context.database.batch(
    open.map((request) =>
      markRecheckRequestSatisfiedStatement(context.database, {
        id: request.id,
        checkId,
        satisfiedAt,
      }),
    ),
  );

  return { matterId, checkId, causesSatisfied: open.length };
}
