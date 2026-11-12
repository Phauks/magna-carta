import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { raiseSyncIssueStatement } from "@magna-carta/calendar/sync-issue-statements";
import {
  deleteSyncLinkStatement,
  insertPendingSyncLinkStatement,
  markSyncLinkFailedStatement,
  markSyncLinkSyncedStatement,
  selectDeadlineSyncCandidatesStatement,
  selectFirmEventSyncCandidatesStatement,
  selectMatterEventSyncCandidatesStatement,
  selectSyncLinksStatement,
  type SyncCandidateRow,
  type SyncLinkKey,
  type SyncLinkRow,
  type SyncWindow,
} from "@magna-carta/calendar/sync-link-statements";
import {
  desiredCopies,
  planOutbound,
  type OutboundCandidate,
  type OutboundDesired,
  type OutboundStep,
} from "@magna-carta/calendar/sync-outbound";
import type { CalendarSyncPort } from "@magna-carta/calendar/sync-port";
import {
  DEFAULT_FIRM_LIMIT,
  readSyncRules,
  readSyncSubjects,
} from "@magna-carta/calendar/sync-rule-service";
import { visibleMatterPredicate } from "@magna-carta/calendar/visibility";
import { addCalendarDays, civilDateOf } from "@magna-carta/civil-time/civil-date";
import { lastOccurrenceOf, parseRecurrence } from "@magna-carta/civil-time/recurrence";
import type { IntegrationConnectionId, UserId } from "@magna-carta/identifiers/types";
import type { IntegrationProblem } from "@magna-carta/integrations/problem";
import {
  noticeProviderChanges,
  readingOfWrite,
  type ProviderChangesInput,
} from "./provider-changes.ts";

// ONE PASS OVER ONE MEMBER'S CONNECTED ACCOUNT: MAKE THEIR CALENDAR AGREE WITH THEIR RULES.
//
// The decision of what to send is made in @magna-carta/calendar/sync-outbound, from what is in the
// firm's database and nothing else. Once everything is sent, ./provider-changes.ts looks at what
// the member did to the copies, and an edit is carried to the event or raised as a question for
// them. This module is the part that touches things: it reads the inputs, asks the
// provider for each difference in turn, and records what the provider answered. Every write to the
// link table happens beside the provider call it describes, so a pass that stops anywhere leaves a
// table the next pass can continue from.

// How far the pass looks. A month back keeps last week's hearing correct if it is edited after the
// fact; two years ahead covers a trial setting. Nothing outside is sent, and a copy whose event
// ages out of the window is taken back.
const WINDOW_DAYS_BACK = 31;
const WINDOW_DAYS_AHEAD = 731;

// A provider limits how fast one account may be written to, and an alarm has a bounded time to run.
// A pass that has more to do than this stops and says so; the caller runs another.
const STEPS_PER_PASS = 200;

export type OutboundPassOutcome =
  // Everything that should be out is out.
  | { readonly kind: "settled"; readonly report: OutboundPassReport }
  // The pass did what it could in one run and there is more.
  | { readonly kind: "more"; readonly report: OutboundPassReport }
  // The provider could not be reached, or asked for patience. Nothing is wrong with the account.
  | { readonly kind: "unavailable"; readonly report: OutboundPassReport }
  // The provider refused the sign-in itself.
  | { readonly kind: "sign-in-again"; readonly report: OutboundPassReport };

export interface OutboundPassReport {
  created: number;
  updated: number;
  removed: number;
  refused: number;
  // Edits a member made to a copy in their own calendar, carried to the event.
  applied: number;
  // Copies a member changed or deleted in their own calendar, raised as questions for them.
  flagged: number;
  // Deadline copies a member changed, written again as they were sent.
  putBack: number;
}

export interface OutboundPassInput {
  readonly database: SqlDatabase;
  readonly connectionId: IntegrationConnectionId;
  readonly memberUserId: UserId;
  readonly port: CalendarSyncPort;
  readonly now: () => Date;
  readonly newTransactionId: () => string;
  // What to do with a copy the member edited. Absent, every edit is a question for them.
  readonly applyProviderEdit?: ProviderChangesInput["applyEdit"];
  // Called once when this pass changed an event in the firm's calendar, so every other account
  // the event is in, and this one, sends it again.
  readonly onEventsChanged?: () => Promise<void>;
}

// The window is cut on the UTC date. Being a day out at either edge of a two-year window changes
// nothing a member could notice, and it keeps the pass from needing a zone of its own.
export function syncWindowAt(instant: Date): SyncWindow {
  return {
    from: addCalendarDays(civilDateOf(instant), -WINDOW_DAYS_BACK),
    to: addCalendarDays(civilDateOf(instant), WINDOW_DAYS_AHEAD),
  };
}

export async function digestOf(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// A series is read whenever it began, so one that has already run its course is dropped here: a
// series whose last day is before the window has nothing left to show. A rule this platform cannot
// read is kept, and is refused further on where the member is told about it.
function reachesWindow(row: SyncCandidateRow, window: SyncWindow): boolean {
  if (row.recurrence_rule === null) return true;
  const rule = parseRecurrence(row.recurrence_rule);
  if (rule === null) return true;
  const lastDay = lastOccurrenceOf(rule, row.starts_on);
  return lastDay === null || lastDay >= window.from;
}

async function readCandidates(
  database: SqlDatabase,
  memberUserId: UserId,
  window: SyncWindow,
): Promise<OutboundCandidate[]> {
  const visibility = visibleMatterPredicate();
  const [matterEvents, firmEvents, deadlines] = await Promise.all([
    selectMatterEventSyncCandidatesStatement(
      database,
      visibility,
      memberUserId,
      window,
    ).all<SyncCandidateRow>(),
    selectFirmEventSyncCandidatesStatement(database, memberUserId, window).all<SyncCandidateRow>(),
    selectDeadlineSyncCandidatesStatement(
      database,
      visibility,
      memberUserId,
      window,
    ).all<SyncCandidateRow>(),
  ]);
  return [
    ...matterEvents.results
      .filter((row) => reachesWindow(row, window))
      .map((row): OutboundCandidate => ({ localKind: "matter_event", row })),
    ...firmEvents.results
      .filter((row) => reachesWindow(row, window))
      .map((row): OutboundCandidate => ({ localKind: "firm_event", row })),
    ...deadlines.results.map((row): OutboundCandidate => ({ localKind: "deadline", row })),
  ];
}

// What a refusal means for the rest of the pass. A refused sign-in or an unreachable provider will
// refuse every later step the same way, so the pass stops; a refusal of one event's own content is
// that event's alone, and the pass goes on to the next.
function stopFor(problem: IntegrationProblem | undefined): "sign-in-again" | "unavailable" | null {
  if (problem === undefined) return "unavailable";
  if (problem.category === "auth") return "sign-in-again";
  if (problem.category === "validation") return null;
  return "unavailable";
}

export async function runOutboundPass(input: OutboundPassInput): Promise<OutboundPassOutcome> {
  const { database, connectionId, port } = input;
  const report: OutboundPassReport = {
    created: 0,
    updated: 0,
    removed: 0,
    refused: 0,
    applied: 0,
    flagged: 0,
    putBack: 0,
  };

  const [rules, subjects, links, candidates] = await Promise.all([
    readSyncRules(database, connectionId),
    readSyncSubjects(database),
    selectSyncLinksStatement(database, connectionId).all<SyncLinkRow>(),
    readCandidates(database, input.memberUserId, syncWindowAt(input.now())),
  ]);
  const limits = new Map(subjects.map((subject) => [subject.subject, subject]));
  const desired = desiredCopies(
    rules,
    (subject) => limits.get(subject) ?? DEFAULT_FIRM_LIMIT,
    candidates,
  );
  const { steps, digests } = await planOutbound(desired, links.results, digestOf);

  const keyOf = (localKind: SyncLinkKey["localKind"], localId: string): SyncLinkKey => ({
    connectionId,
    localKind,
    localId,
  });

  // The provider will not take this one event as it stands. The link remembers it was tried, and
  // the member is told on their Calendar Sync page, because an event quietly missing from a
  // calendar somebody trusts is the failure this whole feature exists to prevent.
  async function recordRefusal(
    key: SyncLinkKey,
    digest: string,
    copy: OutboundDesired,
    stamp: string,
  ): Promise<void> {
    await markSyncLinkFailedStatement(database, key, digest, stamp).run();
    await raiseSyncIssueStatement(
      database,
      key,
      {
        kind: "not_sent",
        remoteVersionTag: null,
        sentJson: JSON.stringify(readingOfWrite(copy.event)),
        foundJson: null,
      },
      stamp,
    ).run();
  }

  async function apply(step: OutboundStep): Promise<"sign-in-again" | "unavailable" | null> {
    const stamp = input.now().toISOString();
    if (step.action === "remove") {
      const key = keyOf(step.link.local_kind, step.link.local_id);
      if (step.link.remote_event_id !== null) {
        const removed = await port.deleteEvent(step.link.remote_event_id);
        if (!removed.ok) {
          const stop = stopFor(removed.problem);
          // The provider will not delete this one copy for a reason of its own. The link goes
          // anyway: keeping it would retry a refusal for ever, and the copy is the member's to
          // delete from their own calendar.
          if (stop !== null) return stop;
          report.refused += 1;
        }
      }
      await deleteSyncLinkStatement(database, key).run();
      report.removed += 1;
      return null;
    }

    const key = keyOf(step.desired.localKind, step.desired.localId);
    const digest = digests.get(step.desired) ?? "";
    if (step.action === "create") {
      const transactionId = step.link?.transaction_id ?? input.newTransactionId();
      if (step.link === null) {
        await insertPendingSyncLinkStatement(
          database,
          key,
          { calendarRemoteId: step.desired.calendarRemoteId, transactionId, agreedHash: digest },
          stamp,
        ).run();
      }
      const created = await port.createEvent(
        step.desired.calendarRemoteId,
        step.desired.event,
        transactionId,
      );
      if (!created.ok) {
        const stop = stopFor(created.problem);
        if (stop !== null) return stop;
        await recordRefusal(key, digest, step.desired, stamp);
        report.refused += 1;
        return null;
      }
      await markSyncLinkSyncedStatement(
        database,
        key,
        {
          remoteEventId: created.value.remoteId,
          remoteVersionTag: created.value.versionTag,
          agreedHash: digest,
        },
        stamp,
      ).run();
      report.created += 1;
      return null;
    }

    const remoteEventId = step.link.remote_event_id;
    if (remoteEventId === null) return null;
    const updated = await port.updateEvent(remoteEventId, step.desired.event);
    if (!updated.ok) {
      const stop = stopFor(updated.problem);
      if (stop !== null) return stop;
      await recordRefusal(key, digest, step.desired, stamp);
      report.refused += 1;
      return null;
    }
    // A copy the member deleted from their own calendar is left deleted. The link stays and records
    // the event as it now stands, so the pass does not put back something a person removed on
    // purpose; taking it out of the rule and back in is how they ask for it again.
    await markSyncLinkSyncedStatement(
      database,
      key,
      {
        remoteEventId,
        remoteVersionTag: updated.value.found ? updated.value.versionTag : null,
        agreedHash: digest,
      },
      stamp,
    ).run();
    if (updated.value.found) report.updated += 1;
    return null;
  }

  for (const step of steps.slice(0, STEPS_PER_PASS)) {
    const stop = await apply(step);
    if (stop !== null) return { kind: stop, report };
  }
  if (steps.length > STEPS_PER_PASS) return { kind: "more", report };

  // Everything that should be out is out. Now look at what the member did to the copies. A pass
  // with more to send does not look: it would be comparing against copies it is about to write.
  const noticed = await noticeProviderChanges({
    database,
    connectionId,
    port,
    desired,
    digestFor: (copy) => digests.get(copy) ?? "",
    stamp: input.now().toISOString(),
    ...(input.applyProviderEdit === undefined ? {} : { applyEdit: input.applyProviderEdit }),
  });
  report.applied = noticed.report.applied;
  if (noticed.report.applied > 0) await input.onEventsChanged?.();
  report.flagged = noticed.report.flagged;
  report.putBack = noticed.report.putBack;
  if (noticed.kind === "stopped") {
    // A provider that will not hand back one list is not a reason to try again every few minutes:
    // everything is sent, and the next safety pass looks again.
    const stop = stopFor(noticed.problem);
    if (stop !== null) return { kind: stop, report };
  }
  return { kind: "settled", report };
}
