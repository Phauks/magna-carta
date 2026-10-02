import { civilDateOf } from "@magna-carta/civil-time/civil-date";
import { collectCustodyReminders } from "@magna-carta/custodian/reminders";
import {
  selectMatterDeadlinesStatement,
  readOpenDeadlineTimeZones,
  type MatterDeadlineRow,
} from "@magna-carta/calendar/deadline-statements";
import {
  CALENDAR_DEADLINE_DUE_EMISSION_POINT,
  CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT,
} from "@magna-carta/calendar/notifications";
import { isOverdue, overdueCutoffFor, type OverdueCutoff } from "@magna-carta/calendar/overdue";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import type { BatchDatabase } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import {
  CUSTODY_EMISSION_POINT_BY_REASON,
  CUSTODY_REVIEW_DUE_EMISSION_POINT,
} from "./emission-points.ts";
import { FactsValidationError } from "./facts-grammar.ts";
import { comparisonDedupeKey, materializeNotification } from "./materialize.ts";
import { createNotificationPolicyReader, type NotificationPolicyReader } from "./preferences.ts";
import { resolveNotificationRecipients } from "./recipients.ts";
import { notificationTypesForComparisonPoint } from "./registry.ts";
import { insertNotificationStatements } from "./statements.ts";
import { inAppSuppressionEffects, type InAppSuppressionCount } from "./suppression-statements.ts";
import { MAX_COMPARISON_FINDINGS_PER_KIND, MAX_SWEEP_STATEMENTS_PER_WRITE } from "./types.ts";

// THE COMPARISON-DRIVEN PRODUCTION PATH.
//
// Some of the things a firm most needs telling about are not events at all. Nothing writes "this
// deadline is overdue"; the calendar refuses to, deliberately, because a stored flag needs a sweep
// to maintain, can be stale where a subtraction cannot, and would make the platform assert
// something about a firm's conduct it is not in a position to assert. Nothing in the custody
// register schedules anything either. Both are QUERIES, and both are already written.
//
// So this pass does not restate what is due. It calls the shipped comparison — the calendar's own
// overdue arithmetic, the register's own `collectCustodyReminders` — and materializes what comes
// back. A second definition of "what is due" would eventually disagree with the first, and the one
// people acted on would be whichever they happened to be looking at.
//
// Two properties everything below turns on:
//
//   * A COMPARISON IS TRUE CONTINUOUSLY. `overdue` does not stop being true, so a dedupe key built
//     from the finding alone would raise a row every pass, forever. The key carries a CIVIL DATE and
//     the row is raised once per day per subject. That is also what makes the pass safe to re-run
//     and safe to move to a different cadence without touching correctness.
//   * A COMPARISON IS UNBOUNDED. The read is capped per kind, the clamp is counted, and no kind can
//     starve another.

export interface ComparisonFinding {
  // The emission point the finding belongs to, which is what resolves it to a registry type.
  readonly emissionPoint: string;
  readonly subjectId: string;
  readonly matterId: string | null;
  // The bucket the dedupe key is built on: the civil date the comparison was true on, in the
  // subject's OWN zone. "Which day is it" has a different answer in Reno and in Berlin, and a
  // deadline's zone is the court's rather than the office's.
  readonly civilDate: string;
  // What the registry type's `buildFacts` reads. The same contract a producer's outbox payload
  // meets, so the materializer is one implementation for all three production paths.
  readonly payload: Readonly<Record<string, unknown>>;
}

// What one comparison kind did on one pass. Reported PER EMISSION POINT rather than only as a
// total, for the reason the counter catalog gives about the open bus: a kind that silently stops
// producing looks exactly like a kind nobody registered, and a sum over every kind hides it.
export interface ComparisonKindCounts {
  readonly materializedEvents: number;
  readonly recipientRows: number;
  // Findings whose type resolved to nobody. Worth counting rather than silently succeeding at: a
  // kind that never reaches anybody is either a resolver bug or an audience nobody has configured,
  // and both are invisible without this.
  readonly emptyAudiences: number;
  readonly clampedRecipients: number;
  // Findings the per-kind cap removed before they were ever considered. A firm reporting this every
  // night is a firm being told about some of its overdue work and not the rest.
  readonly clampedFindings: number;
  // Passes whose ZONE DISCOVERY was truncated — a different and worse failure than `clampedFindings`,
  // which is why it is not folded into it. A clamped finding count says "we found more than we
  // carried"; a truncated zone list says an entire time zone was never asked about, so every deadline
  // in it produced no finding while every other counter read healthy. Counting PASSES rather than
  // zones is deliberate: a read that over-reads by one to detect its own truncation learns that it
  // truncated and cannot learn by how much, and inventing a magnitude here would be the same dishonesty
  // one level down.
  readonly truncatedZoneDiscovery: number;
  readonly refusedFacts: number;
  // Members the finding's audience reached who got no feed row because a preference silenced the
  // category. Distinct from `emptyAudiences`: an audience that resolved to nobody is a resolver
  // problem, and an audience everybody in it silenced is a setting working as asked.
  readonly preferenceSuppressed: number;
}

export interface ComparisonSweepResult {
  readonly findings: number;
  readonly byEmissionPoint: ReadonlyMap<string, ComparisonKindCounts>;
  // The same suppressions again, aggregated by the two closed labels a counter may carry.
  readonly suppressedInApp: readonly InAppSuppressionCount[];
}

const NO_COUNTS: ComparisonKindCounts = {
  materializedEvents: 0,
  recipientRows: 0,
  emptyAudiences: 0,
  clampedRecipients: 0,
  clampedFindings: 0,
  truncatedZoneDiscovery: 0,
  refusedFacts: 0,
  preferenceSuppressed: 0,
};

// A mutable tally keyed by emission point. Kept private so the result a caller sees is read-only.
class KindTally {
  private readonly counts = new Map<string, ComparisonKindCounts>();

  add(emissionPoint: string, delta: Partial<ComparisonKindCounts>): void {
    const current = this.counts.get(emissionPoint) ?? NO_COUNTS;
    this.counts.set(emissionPoint, {
      materializedEvents: current.materializedEvents + (delta.materializedEvents ?? 0),
      recipientRows: current.recipientRows + (delta.recipientRows ?? 0),
      emptyAudiences: current.emptyAudiences + (delta.emptyAudiences ?? 0),
      clampedRecipients: current.clampedRecipients + (delta.clampedRecipients ?? 0),
      clampedFindings: current.clampedFindings + (delta.clampedFindings ?? 0),
      truncatedZoneDiscovery: current.truncatedZoneDiscovery + (delta.truncatedZoneDiscovery ?? 0),
      refusedFacts: current.refusedFacts + (delta.refusedFacts ?? 0),
      preferenceSuppressed: current.preferenceSuppressed + (delta.preferenceSuppressed ?? 0),
    });
  }

  frozen(): ReadonlyMap<string, ComparisonKindCounts> {
    return this.counts;
  }
}

export interface ComparisonSweepOptions {
  readonly database: BatchDatabase;
  // The pass's own instant, supplied rather than read: this package holds no clock.
  readonly now: string;
  readonly randomSource?: RandomSource;
}

// One firm's whole comparison pass: collect from every shipped comparison, then materialize.
export async function sweepFirmComparisonNotifications(
  options: ComparisonSweepOptions,
): Promise<ComparisonSweepResult> {
  const collections = await Promise.all([
    collectDeadlineFindings(options.database, options.now),
    collectCustodyFindings(options.database, options.now),
  ]);
  const tally = new KindTally();
  const findings: ComparisonFinding[] = [];
  for (const collection of collections) {
    findings.push(...collection.findings);
    for (const [emissionPoint, delta] of collection.countsByEmissionPoint) {
      tally.add(emissionPoint, delta);
    }
  }
  const suppressedInApp = await materializeComparisonFindings({
    database: options.database,
    findings,
    now: options.now,
    randomSource: options.randomSource,
    tally,
    // ONE reader for the whole firm pass. A firm's overdue deadlines resolve to the same handful of
    // people hundreds of times over, and asking the preference chain per finding would double the
    // pass's query count for an answer that does not change inside it.
    policy: createNotificationPolicyReader(options.database),
  });
  return { findings: findings.length, byEmissionPoint: tally.frozen(), suppressedInApp };
}

interface Collection {
  readonly findings: readonly ComparisonFinding[];
  // What the collection itself already knows about its own incompleteness, in the tally's own delta
  // shape so a collector can report any counter it learns rather than only a clamp. Carrying one map
  // of deltas instead of one map per counter is what keeps a new kind of incompleteness from needing
  // a new parallel channel — which is how the zone-discovery truncation went uncounted.
  readonly countsByEmissionPoint: ReadonlyMap<string, Partial<ComparisonKindCounts>>;
}

// ---- the calendar's comparison ----

// Open deadlines that are due today or already past due, each in its own zone.
//
// The overdue set narrows IN SQL, through the calendar's own per-zone cutoff bound — exact rather
// than an approximation, because `due_on <= today-in-UTC` reports a Los Angeles deadline as missed
// twenty hours before it is. The due-today set is read over the at-most-two civil dates the world's
// zones currently span and then assigned to a zone in memory: at two days of one firm's open
// deadlines that is a bounded read, and there is no per-zone SQL bound for "due today" the way
// there is for "overdue".
async function collectDeadlineFindings(database: SqlDatabase, now: string): Promise<Collection> {
  const visibility = visibleMatterPredicate();
  const visibilityFragment = visibility.fragmentFor("matter_deadline.matter_id");
  const nowCivilDate = civilDateOf(now);
  // A day either side of the platform's own civil date covers every zone in use, and bounds the
  // zone-discovery read to deadlines that could plausibly be due or overdue right now.
  const zoneDiscoveryCeiling = civilDateOffsetByDays(nowCivilDate, 1);

  // The zone read reports its own truncation, so this pass consumes that signal rather than
  // re-deriving it. Counted apart from `clampedFindings` because the consequence is worse: a dropped
  // finding is one thing the firm is not told about, where a dropped ZONE is every deadline in that
  // zone, silently — a zone that never reaches `overdueCutoffFor` contributes no cutoff, so its
  // deadlines match neither the overdue bound nor the due-today window. The pass would then report
  // zero findings for a whole jurisdiction with `clampedFindings` at zero beside it: a check that
  // stopped looking and still read as coverage.
  const discovery = await readOpenDeadlineTimeZones(database, {
    throughDate: zoneDiscoveryCeiling,
    limit: MAX_COMPARISON_FINDINGS_PER_KIND,
    visibilityFragment,
    visibilityBindings: visibility.bindings,
  });
  // Charged to BOTH deadline points, because the zone list feeds both reads and both are therefore
  // incomplete. It is one truncation reported twice rather than a magnitude double-counted: the value
  // is a count of truncated passes, and each kind's coverage is independently in question.
  const truncationCounts: Partial<ComparisonKindCounts> = discovery.clamped
    ? { truncatedZoneDiscovery: 1 }
    : {};
  const countsByEmissionPoint = new Map<string, Partial<ComparisonKindCounts>>();

  const cutoffs = discovery.timeZones
    .map((zone) => overdueCutoffFor(zone, now))
    .filter((cutoff): cutoff is OverdueCutoff => cutoff !== undefined);
  if (cutoffs.length === 0) {
    // Nothing to compare, and if the zone list was truncated that is not the same statement as "this
    // firm has no open deadlines" — so the truncation is still reported from the early return.
    if (discovery.clamped) {
      countsByEmissionPoint.set(CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT, truncationCounts);
      countsByEmissionPoint.set(CALENDAR_DEADLINE_DUE_EMISSION_POINT, truncationCounts);
    }
    return { findings: [], countsByEmissionPoint };
  }

  const currentCivilDateByZone = new Map(
    cutoffs.map((cutoff) => [cutoff.timeZone, cutoff.currentCivilDate]),
  );
  const civilDates = [...currentCivilDateByZone.values()].toSorted();

  // Read one more than the cap so a clamp is DETECTED rather than inferred from a full page, which
  // is the same reason a keyset page over-reads by one.
  const [overdueRows, dueWindowRows] = await Promise.all([
    allDeadlines(
      selectMatterDeadlinesStatement(database, {
        overdueCutoffs: cutoffs,
        limit: MAX_COMPARISON_FINDINGS_PER_KIND + 1,
        visibilityFragment,
        visibilityBindings: visibility.bindings,
      }),
    ),
    allDeadlines(
      selectMatterDeadlinesStatement(database, {
        state: "open",
        fromDate: civilDates[0],
        throughDate: civilDates[civilDates.length - 1],
        limit: MAX_COMPARISON_FINDINGS_PER_KIND + 1,
        visibilityFragment,
        visibilityBindings: visibility.bindings,
      }),
    ),
  ]);

  const overdue = clamp(overdueRows);
  const dueToday = clamp(
    dueWindowRows.filter(
      (row) =>
        row.due_on === currentCivilDateByZone.get(row.time_zone) &&
        // A deadline due today whose hour has already passed is overdue, and it is reported ONCE, as
        // the more urgent of the two. Two rows saying the same thing at two severities is how a feed
        // teaches people that severity means nothing.
        !isOverdue(
          {
            dueOn: row.due_on,
            dueAtTime: row.due_at_time,
            timeZone: row.time_zone,
            state: row.state,
          },
          now,
        ),
    ),
  );

  countsByEmissionPoint.set(CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT, {
    ...truncationCounts,
    clampedFindings: overdue.clamped,
  });
  countsByEmissionPoint.set(CALENDAR_DEADLINE_DUE_EMISSION_POINT, {
    ...truncationCounts,
    clampedFindings: dueToday.clamped,
  });

  return {
    countsByEmissionPoint,
    findings: [
      ...overdue.kept.map((row) =>
        deadlineFinding(CALENDAR_DEADLINE_OVERDUE_EMISSION_POINT, row, currentCivilDateByZone, now),
      ),
      ...dueToday.kept.map((row) =>
        deadlineFinding(CALENDAR_DEADLINE_DUE_EMISSION_POINT, row, currentCivilDateByZone, now),
      ),
    ],
  };
}

async function allDeadlines(statement: SqlStatement): Promise<MatterDeadlineRow[]> {
  const { results } = await statement.all<MatterDeadlineRow>();
  return results;
}

function deadlineFinding(
  emissionPoint: string,
  row: MatterDeadlineRow,
  currentCivilDateByZone: ReadonlyMap<string, string>,
  now: string,
): ComparisonFinding {
  // The bucket is the zone's OWN civil date, so the same deadline raises once per day of the court's
  // calendar rather than once per day of UTC's. Falling back to the platform's date would only
  // happen for a zone the runtime cannot resolve, which the cutoff filter has already removed.
  const civilDate = currentCivilDateByZone.get(row.time_zone) ?? civilDateOf(now);
  return {
    emissionPoint,
    subjectId: row.id,
    matterId: row.matter_id,
    civilDate,
    payload: {
      matterDeadlineId: row.id,
      matterId: row.matter_id,
      daysOverdue: wholeDaysBetween(row.due_on, civilDate),
    },
  };
}

// ---- the custody register's comparison ----

// `collectCustodyReminders` and nothing else: the register settled that delivery subscribes to that
// one function rather than growing a second definition of what is due, and the reports the register
// already ships read exactly the same call.
async function collectCustodyFindings(database: SqlDatabase, now: string): Promise<Collection> {
  const civilDate = civilDateOf(now);
  const reminders = await collectCustodyReminders(database, civilDate, {
    limit: MAX_COMPARISON_FINDINGS_PER_KIND + 1,
  });
  // The register's own `capped` answers a DIFFERENT question from this clamp — it says a reason hit
  // its per-reason ceiling, where the clamp says this sweep will not materialize more than its own
  // per-kind ceiling. The clamp is the one this pass acts on, and it is charged below.
  const { kept, clamped } = clamp(reminders.reminders);
  return {
    // The register caps both reasons in one read and reports one combined list, so a clamp cannot be
    // attributed to a reason without asking it a second question. It is charged to the review point,
    // which is the one both reads share a ceiling with, rather than double-counted or dropped.
    countsByEmissionPoint: new Map([
      [CUSTODY_REVIEW_DUE_EMISSION_POINT, { clampedFindings: clamped }],
    ]),
    findings: kept.map((reminder) => ({
      emissionPoint: CUSTODY_EMISSION_POINT_BY_REASON[reminder.reason],
      subjectId: reminder.packetId,
      // A packet is firm-scoped by construction — originals held for somebody who is not yet a
      // client are the reason the platform keeps a holding matter — so there is no matter to anchor
      // to and inventing one would file the reminder behind a filter it must not be behind.
      matterId: null,
      // The register keeps no zone: it is one firm's own list, and its dates are civil dates the
      // firm typed. The platform's civil day is therefore the honest bucket here, where a deadline's
      // is the court's.
      civilDate,
      payload: {
        custodyPacketId: reminder.packetId,
        daysOverdue: reminder.daysOverdue,
        bucket: reminder.bucket,
      },
    })),
  };
}

// ---- materialization ----

async function materializeComparisonFindings(options: {
  readonly database: BatchDatabase;
  readonly findings: readonly ComparisonFinding[];
  readonly now: string;
  readonly randomSource?: RandomSource;
  readonly tally: KindTally;
  readonly policy: NotificationPolicyReader;
}): Promise<readonly InAppSuppressionCount[]> {
  const suppressedInApp: InAppSuppressionCount[] = [];
  let pending: SqlStatement[] = [];

  const flush = async (): Promise<void> => {
    if (pending.length === 0) return;
    await options.database.batch(pending);
    pending = [];
  };

  for (const finding of options.findings) {
    for (const type of notificationTypesForComparisonPoint(finding.emissionPoint)) {
      const audience = await resolveNotificationRecipients(type, {
        database: options.database,
        matterId: finding.matterId,
        // A comparison has no actor. Nobody made the deadline arrive.
        actorUserId: null,
        // And it names nobody: a comparison finds a condition, not a person. No type raised by this
        // path declares `named-recipient`, and one that did would reach nobody rather than guess.
        namedRecipientUserId: null,
        namedMemberUserIds: [],
        now: () => options.now,
        policy: options.policy,
      });

      // Recorded whether or not an event follows: a category everybody silenced writes no event,
      // and the tally is then the only record that anything was decided.
      const suppression = inAppSuppressionEffects(options.database, {
        category: type.category,
        suppressed: audience.suppressed,
        now: options.now,
      });
      pending.push(...suppression.statements);
      suppressedInApp.push(...suppression.counts);
      if (audience.suppressed.length > 0) {
        options.tally.add(finding.emissionPoint, {
          preferenceSuppressed: audience.suppressed.length,
        });
      }

      if (audience.recipientUserIds.length === 0) {
        // An event row nobody can see is a row only the retention sweep will ever touch. An audience
        // that resolved to nobody and an audience everybody in it silenced are counted apart: only
        // the first is a resolver problem.
        if (audience.suppressed.length === 0) {
          options.tally.add(finding.emissionPoint, { emptyAudiences: 1 });
        }
        if (pending.length >= MAX_SWEEP_STATEMENTS_PER_WRITE) await flush();
        continue;
      }

      let materialization;
      try {
        materialization = materializeNotification({
          type,
          payload: finding.payload,
          subjectId: finding.subjectId,
          matterId: finding.matterId,
          recipientUserIds: audience.recipientUserIds,
          dedupeKey: comparisonDedupeKey(type.key, finding.subjectId, finding.civilDate),
          // The comparison became true at some point this pass cannot know; the pass's own instant
          // is the only witness there is, and it is what the feed orders and the digest windows on.
          occurredAt: options.now,
          createdAt: options.now,
          randomSource: options.randomSource,
        });
      } catch (caught) {
        if (caught instanceof FactsValidationError) {
          // A finding whose shape the type refuses. PERMANENT — no retry makes it conform — so it is
          // counted and its siblings still run.
          options.tally.add(finding.emissionPoint, { refusedFacts: 1 });
          continue;
        }
        throw caught;
      }

      pending.push(...insertNotificationStatements(options.database, materialization));
      options.tally.add(finding.emissionPoint, {
        materializedEvents: 1,
        recipientRows: materialization.recipients.length,
        clampedRecipients: materialization.clampedRecipients,
      });
      if (pending.length >= MAX_SWEEP_STATEMENTS_PER_WRITE) await flush();
    }
  }
  await flush();
  return suppressedInApp;
}

// ---- small shared arithmetic ----

function clamp<T>(rows: readonly T[]): { kept: readonly T[]; clamped: number } {
  return rows.length <= MAX_COMPARISON_FINDINGS_PER_KIND
    ? { kept: rows, clamped: 0 }
    : {
        kept: rows.slice(0, MAX_COMPARISON_FINDINGS_PER_KIND),
        clamped: rows.length - MAX_COMPARISON_FINDINGS_PER_KIND,
      };
}

// Whole days between two civil dates, floored at zero. Civil-date subtraction and nothing else — no
// zone is consulted, because both operands are already civil dates in the same calendar and the
// answer is a count of days rather than a duration.
function wholeDaysBetween(fromCivilDate: string, toCivilDate: string): number {
  const from = Date.parse(`${fromCivilDate}T00:00:00.000Z`);
  const to = Date.parse(`${toCivilDate}T00:00:00.000Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function civilDateOffsetByDays(civilDate: string, days: number): string {
  const base = Date.parse(`${civilDate}T00:00:00.000Z`);
  if (Number.isNaN(base)) return civilDate;
  return civilDateOf(new Date(base + days * 86_400_000));
}
