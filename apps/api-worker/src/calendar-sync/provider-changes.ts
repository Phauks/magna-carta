import {
  deleteSyncIssueStatement,
  deleteSyncIssuesWithoutLinkStatement,
  raiseSyncIssueStatement,
  selectSyncIssuesStatement,
  type SyncCopyReading,
  type SyncIssueRow,
} from "@magna-carta/calendar/sync-issue-statements";
import {
  markSyncLinkSyncedStatement,
  recordSyncLinkVersionStatement,
  selectSyncLinksStatement,
  type SyncLinkKey,
  type SyncLinkRow,
} from "@magna-carta/calendar/sync-link-statements";
import type { OutboundDesired } from "@magna-carta/calendar/sync-outbound";
import type {
  CalendarSyncPort,
  ProviderEventSnapshot,
  ProviderEventWrite,
} from "@magna-carta/calendar/sync-port";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { isOccurrenceOf, movedLikeOccurrence } from "@magna-carta/civil-time/recurrence";
import { zonedReading } from "@magna-carta/civil-time/time-zone";
import type { IntegrationConnectionId } from "@magna-carta/identifiers/types";
import type { IntegrationProblem } from "@magna-carta/integrations/problem";

// WHAT A MEMBER DID TO A COPY IN THEIR OWN CALENDAR.
//
// A pass that has finished sending looks at the copies it wrote and compares each with the event as
// it stands. What happens to a copy that reads differently is one of three things, and which one
// is decided by the caller's `applyEdit` (./apply-provider-edit.ts):
//
//   - the edit is carried to the event, which is the ordinary case for a member who may edit it;
//   - the copy is written again as it was sent, where nothing in the edit can be carried;
//   - the member is asked, on their Calendar Sync page, where the edit may not be carried.
//
// A copy that is GONE is always a question. Taking something out of your own calendar is not
// cancelling a hearing, and nothing here ever cancels one.
//
// A deadline's copy is always put back as it was sent, without asking, because a deadline that
// reads a day late in somebody's calendar is the one difference that can hurt a client.
//
// ONE DAY OF A SERIES, CHANGED ON ITS OWN, is looked for last. A series leaves as one copy with
// its rule, so a member who drags next Tuesday's sitting to the afternoon has changed nothing the
// comparison above can see. Each series' changed days are asked for, and a day that reads
// differently is carried to the event as that day's own change, exactly as "this event only" does
// in the event's own window. A day whose change cannot be carried is written back as it was sent:
// there is no question to ask about one day, and a day that reads wrong is the worse outcome. A
// day the member deleted is not seen, and is never a cancellation.
//
// Only copies this platform wrote are read. The provider is asked for the events carrying the
// platform's own mark and for nothing else, so an event the member made themselves is never seen.

// A copy missing from the list is confirmed one at a time before it is called gone, and a pass
// asks for only this many confirmations. The rest wait for the next pass.
const REMOVAL_CONFIRMATIONS_PER_PASS = 25;

// A pass asks about the changed days of only this many series. Each is one request.
const SERIES_LOOKS_PER_PASS = 100;

const blankToNull = (text: string | null): string | null =>
  text === null || text.trim() === "" ? null : text.trim();

// The event as it was sent, in the fields a member can see. A timed event with no end was sent
// ending when it starts, and reads that way here so the two sides compare.
export function readingOfWrite(event: ProviderEventWrite): SyncCopyReading {
  const allDay = event.startsAtTime === null;
  return {
    title: event.title.trim(),
    location: blankToNull(event.location),
    startsOn: event.startsOn,
    startsAtTime: event.startsAtTime,
    endsOn: event.endsOn ?? event.startsOn,
    endsAtTime: allDay ? null : (event.endsAtTime ?? event.startsAtTime),
    timeZone: event.timeZone,
  };
}

// The copy as the provider holds it, read in the zone the event was written in. A member who moved
// a hearing sees the new time on the wall clock of the court's zone, which is where the event lives.
export function readingOfSnapshot(
  snapshot: ProviderEventSnapshot,
  timeZone: string,
): SyncCopyReading {
  const shared = {
    title: snapshot.title.trim(),
    location: blankToNull(snapshot.location),
    timeZone,
  };
  if (snapshot.when.kind === "days") {
    return {
      ...shared,
      startsOn: snapshot.when.startsOn,
      startsAtTime: null,
      endsOn: snapshot.when.endsOn,
      endsAtTime: null,
    };
  }
  const start = zonedReading(snapshot.when.startsAtMilliseconds, timeZone);
  const end = zonedReading(snapshot.when.endsAtMilliseconds, timeZone);
  return {
    ...shared,
    startsOn: start.civilDate,
    startsAtTime: start.wallClockTime,
    endsOn: end.civilDate,
    endsAtTime: end.wallClockTime,
  };
}

export function sameReading(left: SyncCopyReading, right: SyncCopyReading): boolean {
  return (
    left.title === right.title &&
    left.location === right.location &&
    left.startsOn === right.startsOn &&
    left.startsAtTime === right.startsAtTime &&
    left.endsOn === right.endsOn &&
    left.endsAtTime === right.endsAtTime
  );
}

export type ProviderEditDecision =
  // The event now reads as the copy does.
  | "applied"
  // Nothing in the edit can be carried to the event. The copy is written again as it was sent.
  | "put-back"
  // The edit could be carried but may not be, or the event would not take it. The member is asked.
  | "ask";

export interface ProviderChangesReport {
  // Edits carried to the event.
  applied: number;
  // Questions raised for the member in this pass.
  flagged: number;
  // Deadline copies written again as they were sent.
  putBack: number;
}

export interface ProviderChangesInput {
  readonly database: SqlDatabase;
  readonly connectionId: IntegrationConnectionId;
  readonly port: CalendarSyncPort;
  readonly desired: readonly OutboundDesired[];
  readonly digestFor: (copy: OutboundDesired) => string;
  readonly stamp: string;
  // What to do with a copy that reads differently. Absent, every edit is a question.
  readonly applyEdit?: (
    copy: OutboundDesired,
    sent: SyncCopyReading,
    found: SyncCopyReading,
    // Present when the edit is to one day of a series: the day it fell on before the edit.
    occurrenceOn?: string,
  ) => Promise<ProviderEditDecision>;
}

// One day of a series as it was sent: the series' own reading, carried onto that day.
export function readingOfSeriesDay(series: SyncCopyReading, occurrenceOn: string): SyncCopyReading {
  return {
    ...series,
    startsOn: occurrenceOn,
    endsOn: movedLikeOccurrence(series.endsOn, series.startsOn, occurrenceOn),
  };
}

export type ProviderChangesOutcome =
  | { readonly kind: "looked"; readonly report: ProviderChangesReport }
  // The provider could not answer. What it means for the pass is the caller's to decide.
  | {
      readonly kind: "stopped";
      readonly problem: IntegrationProblem | undefined;
      readonly report: ProviderChangesReport;
    };

export async function noticeProviderChanges(
  input: ProviderChangesInput,
): Promise<ProviderChangesOutcome> {
  const { database, connectionId, port, stamp } = input;
  const report: ProviderChangesReport = { applied: 0, flagged: 0, putBack: 0 };

  const listed = await port.listWrittenEvents();
  if (!listed.ok) return { kind: "stopped", problem: listed.problem, report };

  const [links, issues] = await Promise.all([
    selectSyncLinksStatement(database, connectionId).all<SyncLinkRow>(),
    selectSyncIssuesStatement(database, connectionId).all<SyncIssueRow>(),
  ]);
  const keyText = (localKind: string, localId: string): string => `${localKind}:${localId}`;
  const linkByKey = new Map(
    links.results.map((link) => [keyText(link.local_kind, link.local_id), link]),
  );
  const issueByKey = new Map(
    issues.results.map((issue) => [keyText(issue.local_kind, issue.local_id), issue]),
  );
  const snapshotByRemoteId = new Map(listed.value.events.map((event) => [event.remoteId, event]));
  let confirmationsLeft = REMOVAL_CONFIRMATIONS_PER_PASS;

  for (const copy of input.desired) {
    const link = linkByKey.get(keyText(copy.localKind, copy.localId));
    if (link === undefined || link.state !== "synced" || link.remote_event_id === null) continue;
    const key: SyncLinkKey = { connectionId, localKind: copy.localKind, localId: copy.localId };
    const issue = issueByKey.get(keyText(copy.localKind, copy.localId));
    const sent = readingOfWrite(copy.event);

    let snapshot: ProviderEventSnapshot | null | undefined = snapshotByRemoteId.get(
      link.remote_event_id,
    );
    if (snapshot === undefined) {
      // Already known to be gone, and the member has been asked. Nothing new to learn.
      if (issue?.kind === "removed") continue;
      if (confirmationsLeft === 0) continue;
      confirmationsLeft -= 1;
      const confirmed = await port.readEvent(link.remote_event_id);
      if (!confirmed.ok) return { kind: "stopped", problem: confirmed.problem, report };
      snapshot = confirmed.value;
    }

    if (snapshot === null) {
      await raiseSyncIssueStatement(
        database,
        key,
        {
          kind: "removed",
          remoteVersionTag: null,
          sentJson: JSON.stringify(sent),
          foundJson: null,
        },
        stamp,
      ).run();
      report.flagged += 1;
      continue;
    }

    // The tag the provider gave our own write is the tag it still has: nobody has touched the copy.
    if (snapshot.versionTag !== null && snapshot.versionTag === link.remote_version_tag) {
      if (issue !== undefined) await deleteSyncIssueStatement(database, key).run();
      continue;
    }

    const found = readingOfSnapshot(snapshot, copy.event.timeZone);
    if (sameReading(sent, found)) {
      if (snapshot.versionTag !== null) {
        await recordSyncLinkVersionStatement(database, key, snapshot.versionTag, stamp).run();
      }
      if (issue !== undefined) await deleteSyncIssueStatement(database, key).run();
      continue;
    }

    const decision: ProviderEditDecision =
      copy.localKind === "deadline"
        ? "put-back"
        : input.applyEdit === undefined
          ? "ask"
          : await input.applyEdit(copy, sent, found);

    if (decision === "applied") {
      // The event has changed, so the next pass writes this copy again in full, which also sets
      // right anything in the edit that was not carried. The tag is kept so this pass's own look
      // is not repeated in the meantime.
      if (snapshot.versionTag !== null) {
        await recordSyncLinkVersionStatement(database, key, snapshot.versionTag, stamp).run();
      }
      if (issue !== undefined) await deleteSyncIssueStatement(database, key).run();
      report.applied += 1;
      continue;
    }

    if (decision === "put-back") {
      const written = await port.updateEvent(link.remote_event_id, copy.event);
      if (!written.ok) return { kind: "stopped", problem: written.problem, report };
      if (written.value.found) {
        await markSyncLinkSyncedStatement(
          database,
          key,
          {
            remoteEventId: link.remote_event_id,
            remoteVersionTag: written.value.versionTag,
            agreedHash: input.digestFor(copy),
          },
          stamp,
        ).run();
        report.putBack += 1;
      }
      continue;
    }

    const foundJson = JSON.stringify(found);
    // The member has already been asked about the copy exactly as it now reads, whether or not
    // they have answered. Asking again would reopen a question they settled.
    if (issue?.kind === "changed" && issue.found_json === foundJson) continue;
    await raiseSyncIssueStatement(
      database,
      key,
      {
        kind: "changed",
        remoteVersionTag: snapshot.versionTag,
        sentJson: JSON.stringify(sent),
        foundJson,
      },
      stamp,
    ).run();
    report.flagged += 1;
  }

  await deleteSyncIssuesWithoutLinkStatement(database, connectionId).run();

  let seriesLooksLeft = SERIES_LOOKS_PER_PASS;
  for (const copy of input.desired) {
    const repeats = copy.event.repeats;
    if (repeats === undefined || repeats === null || repeats.rule === null) continue;
    const link = linkByKey.get(keyText(copy.localKind, copy.localId));
    if (link === undefined || link.state !== "synced" || link.remote_event_id === null) continue;
    if (seriesLooksLeft === 0) break;
    seriesLooksLeft -= 1;

    const changed = await port.listSeriesChangedDays(link.remote_event_id);
    if (!changed.ok) return { kind: "stopped", problem: changed.problem, report };
    const seriesSent = readingOfWrite(copy.event);
    for (const day of changed.value ?? []) {
      const occurrenceOn = zonedReading(
        day.originalStartsAtMilliseconds,
        copy.event.timeZone,
      ).civilDate;
      // A day with a row of its own is about to be taken out of the provider's series, and a day
      // the rule does not fall on is one this pass has misread. Neither is touched.
      if (repeats.skippedDays.includes(occurrenceOn)) continue;
      if (!isOccurrenceOf(repeats.rule, copy.event.startsOn, occurrenceOn)) continue;
      const sent = readingOfSeriesDay(seriesSent, occurrenceOn);
      const found = readingOfSnapshot(day, copy.event.timeZone);
      if (sameReading(sent, found)) continue;

      const decision =
        input.applyEdit === undefined
          ? "put-back"
          : await input.applyEdit(copy, sent, found, occurrenceOn);
      if (decision === "applied") {
        // The day now has a row of its own. The next pass sends that row as an event and takes
        // this day out of the provider's series.
        report.applied += 1;
        continue;
      }
      const written = await port.updateSeriesDay(day.remoteId, {
        ...copy.event,
        startsOn: sent.startsOn,
        endsOn: sent.endsOn === sent.startsOn ? null : sent.endsOn,
        repeats: null,
      });
      if (!written.ok) return { kind: "stopped", problem: written.problem, report };
      if (written.value.found) report.putBack += 1;
    }
  }
  return { kind: "looked", report };
}
