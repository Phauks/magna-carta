import { domainAuditStatement } from "@magna-carta/data-access/audit-statements";
import type { EffectWrite } from "@magna-carta/data-access/effect-batch";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import type { RandomSource } from "@magna-carta/identifiers/random";
import type { IntegrationConnectionId, UserId } from "@magna-carta/identifiers/types";
import { readMatterEventTypes } from "./event-type-statements.ts";
import type { ProviderCalendar } from "./sync-port.ts";
import {
  DEADLINE_SUBJECT,
  deleteSyncRulesForSubjectStatement,
  deleteSyncRulesStatement,
  insertSyncRuleStatement,
  selectSyncFirmLimitsStatement,
  selectSyncRulesStatement,
  upsertSyncFirmLimitStatement,
  type SyncDetailLevel,
  type SyncFirmLimitRow,
  type SyncRuleRow,
  type SyncRuleScope,
} from "./sync-rule-statements.ts";
import type { MatterEventCategory } from "./types.ts";

// WHAT MAY LEAVE, AND WHAT A MEMBER CHOSE TO SEND.
//
// Two layers, and the order between them is the rule this module exists to hold. The firm sets the
// outer limit for each subject (an event type, or deadlines as one kind); a member then chooses,
// inside that limit, which subjects go to which of their own calendars. A member's rule can send
// less than the firm allows and never more, so both writes below enforce it: saving rules refuses a
// subject the firm has closed, and closing a subject removes every member's rule for it in the same
// batch. There is no moment at which a rule outlives the permission it depended on.
//
// Nothing here sends anything. These are the settings a sync pass reads.

export type SyncRuleRefusalCode =
  // A subject that is neither an active event type nor the deadline kind.
  | "calendar-sync-unknown-subject"
  // The same subject twice in one save. Two destinations for one type is not a thing a member can
  // mean, and picking one silently would hide which.
  | "calendar-sync-duplicate-subject"
  // The firm does not let this subject leave.
  | "calendar-sync-subject-not-allowed"
  // A destination that is not one of the member's calendars at the provider.
  | "calendar-sync-unknown-calendar"
  // A destination the member can read and cannot write to.
  | "calendar-sync-calendar-read-only";

export class SyncRuleRefusal extends Error {
  constructor(
    readonly code: SyncRuleRefusalCode,
    readonly subject: string,
    message: string,
  ) {
    super(message);
    this.name = "SyncRuleRefusal";
  }
}

export interface SyncServiceOptions {
  readonly clock: { now(): string };
  readonly actorUserId: UserId;
  readonly randomSource?: RandomSource;
}

// The limit a subject with no row carries: it may leave, in full. See the table's own note in the
// per-firm schema for why the absence is permissive.
export const DEFAULT_FIRM_LIMIT = { mayLeave: true, detail: "full" } as const satisfies {
  mayLeave: boolean;
  detail: SyncDetailLevel;
};

export interface SyncSubject {
  // The event type's id, or the deadline subject.
  readonly subject: string;
  readonly kind: "eventType" | "deadline";
  // The event type's own name; null for the deadline kind, which the screen names itself.
  readonly name: string | null;
  readonly category: MatterEventCategory | null;
  readonly mayLeave: boolean;
  readonly detail: SyncDetailLevel;
}

// Every subject a rule can name, each with the firm's limit on it: the active event types in catalog
// order, then deadlines. One row per event type, never a group of them.
export async function readSyncSubjects(database: SqlDatabase): Promise<SyncSubject[]> {
  const [types, limits] = await Promise.all([
    readMatterEventTypes(database),
    selectSyncFirmLimitsStatement(database).all<SyncFirmLimitRow>(),
  ]);
  const limitBySubject = new Map(limits.results.map((row) => [row.subject, row]));
  const limitOf = (subject: string) => {
    const row = limitBySubject.get(subject);
    return row === undefined
      ? DEFAULT_FIRM_LIMIT
      : { mayLeave: row.may_leave === 1, detail: row.detail };
  };
  return [
    ...types.map((type): SyncSubject => ({
      subject: type.id,
      kind: "eventType",
      name: type.name,
      category: type.category,
      ...limitOf(type.id),
    })),
    {
      subject: DEADLINE_SUBJECT,
      kind: "deadline",
      name: null,
      category: null,
      ...limitOf(DEADLINE_SUBJECT),
    },
  ];
}

export interface SyncRule {
  readonly subject: string;
  readonly calendarRemoteId: string;
  readonly calendarName: string;
  readonly scope: SyncRuleScope;
}

export async function readSyncRules(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
): Promise<SyncRule[]> {
  const { results } = await selectSyncRulesStatement(database, connectionId).all<SyncRuleRow>();
  return results.map((row) => ({
    subject: row.subject,
    calendarRemoteId: row.calendar_remote_id,
    calendarName: row.calendar_name,
    scope: row.scope,
  }));
}

export interface SyncRuleInput {
  readonly subject: string;
  readonly calendarRemoteId: string;
  readonly scope: SyncRuleScope;
}

// Replaces a member's whole rule set for one connected account. A replace and never a patch: the
// page shows every subject, so what the member saved IS the set, and a subject absent from it is one
// they chose not to send.
//
// `calendars` is the provider's own list, read by the caller in the same request. The name stored
// beside each rule comes from that list and never from the request, so a rule cannot be saved
// pointing at a calendar under a name it does not have.
export async function replaceSyncRules(
  database: SqlDatabase,
  connectionId: IntegrationConnectionId,
  rules: readonly SyncRuleInput[],
  calendars: readonly ProviderCalendar[],
  options: SyncServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const subjects = new Map(
    (await readSyncSubjects(database)).map((entry) => [entry.subject, entry]),
  );
  const calendarById = new Map(calendars.map((calendar) => [calendar.remoteId, calendar]));
  const seen = new Set<string>();
  const now = options.clock.now();
  const inserts: SqlStatement[] = [];
  for (const rule of rules) {
    const subject = subjects.get(rule.subject);
    if (subject === undefined) {
      throw new SyncRuleRefusal(
        "calendar-sync-unknown-subject",
        rule.subject,
        "no active event type has this identifier",
      );
    }
    if (seen.has(rule.subject)) {
      throw new SyncRuleRefusal(
        "calendar-sync-duplicate-subject",
        rule.subject,
        "an event type can be sent to one calendar only",
      );
    }
    seen.add(rule.subject);
    if (!subject.mayLeave) {
      throw new SyncRuleRefusal(
        "calendar-sync-subject-not-allowed",
        rule.subject,
        "the firm does not allow this event type to be synced",
      );
    }
    const calendar = calendarById.get(rule.calendarRemoteId);
    if (calendar === undefined) {
      throw new SyncRuleRefusal(
        "calendar-sync-unknown-calendar",
        rule.subject,
        "the connected account has no such calendar",
      );
    }
    if (!calendar.canWrite) {
      throw new SyncRuleRefusal(
        "calendar-sync-calendar-read-only",
        rule.subject,
        "the connected account cannot add events to that calendar",
      );
    }
    inserts.push(
      insertSyncRuleStatement(
        database,
        connectionId,
        {
          subject: rule.subject,
          calendarRemoteId: calendar.remoteId,
          calendarName: calendar.name,
          scope: rule.scope,
        },
        now,
      ),
    );
  }
  return {
    effect: {
      statements: [
        deleteSyncRulesStatement(database, connectionId),
        ...inserts,
        domainAuditStatement(database, {
          event: "calendar_sync.rules_replaced",
          subjectId: connectionId,
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          // Which subjects, and never which calendars: a calendar's name is the member's own.
          metadata: { subjects: [...seen] },
        }),
      ],
      outboxMessages: [],
    },
  };
}

export interface SyncFirmLimitInput {
  readonly subject: string;
  readonly mayLeave: boolean;
  readonly detail: SyncDetailLevel;
}

// Sets the firm's limit on the subjects named, leaving every other subject as it was. Closing a
// subject removes every member's rule for it in the same batch.
export async function setSyncFirmLimits(
  database: SqlDatabase,
  limits: readonly SyncFirmLimitInput[],
  options: SyncServiceOptions,
): Promise<{ effect: EffectWrite }> {
  const subjects = new Set((await readSyncSubjects(database)).map((entry) => entry.subject));
  const seen = new Set<string>();
  const now = options.clock.now();
  const statements: SqlStatement[] = [];
  for (const limit of limits) {
    if (!subjects.has(limit.subject)) {
      throw new SyncRuleRefusal(
        "calendar-sync-unknown-subject",
        limit.subject,
        "no active event type has this identifier",
      );
    }
    if (seen.has(limit.subject)) {
      throw new SyncRuleRefusal(
        "calendar-sync-duplicate-subject",
        limit.subject,
        "an event type carries one limit",
      );
    }
    seen.add(limit.subject);
    statements.push(upsertSyncFirmLimitStatement(database, limit, options.actorUserId, now));
    if (!limit.mayLeave) {
      statements.push(deleteSyncRulesForSubjectStatement(database, limit.subject));
    }
  }
  return {
    effect: {
      statements: [
        ...statements,
        domainAuditStatement(database, {
          event: "calendar_sync.firm_limits_set",
          subjectId: "calendar_sync.firm_limits",
          actorUserId: options.actorUserId,
          clock: options.clock,
          randomSource: options.randomSource,
          metadata: {
            limits: limits.map((limit) => ({
              subject: limit.subject,
              mayLeave: limit.mayLeave,
              detail: limit.detail,
            })),
          },
        }),
      ],
      outboxMessages: [],
    },
  };
}
