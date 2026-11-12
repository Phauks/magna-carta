import { parseRecurrence } from "@magna-carta/civil-time/recurrence";
import type { ProviderEventRepeat, ProviderEventWrite } from "./sync-port.ts";
import type { SyncCandidateRow, SyncLinkRow, SyncLocalKind } from "./sync-link-statements.ts";
import type { SyncDetailLevel, SyncRuleScope } from "./sync-rule-statements.ts";

// WHAT A PASS SENDS TO A MEMBER'S CALENDAR, DECIDED WITHOUT TOUCHING ANYTHING.
//
// A pass is a reconciliation and never a replay of what changed. It is handed the member's rules,
// the firm's limits, everything in the window that could be theirs, and the copies already out; it
// answers with the difference. That makes every trigger equivalent (an edit, a rule saved, a limit
// closed, a pass that died halfway, a safety pass hours later all ask the same question) and makes
// a missed trigger harmless, because the next pass finds the same difference.
//
// Only the direction out is decided here. Nothing read back from the provider is an input. What a
// member did to a copy is read afterwards, by the pass; an edit it carries back changes the event
// itself, and so reaches this decision the way any other edit to the event does.
//
// A SERIES LEAVES AS ONE EVENT WITH ITS RULE, never as a copy per day. The days a row of its own
// stands in for are named beside the rule so the provider's series can skip them; a changed day is
// that row, and leaves as an ordinary event.

export interface OutboundRule {
  readonly subject: string;
  readonly calendarRemoteId: string;
  readonly scope: SyncRuleScope;
}

export interface OutboundLimit {
  readonly mayLeave: boolean;
  readonly detail: SyncDetailLevel;
}

export interface OutboundCandidate {
  readonly localKind: SyncLocalKind;
  readonly row: SyncCandidateRow;
}

export interface OutboundDesired {
  readonly localKind: SyncLocalKind;
  readonly localId: string;
  readonly calendarRemoteId: string;
  // How much of the event the firm let leave. A copy sent with `minimal` detail carries a title
  // this module wrote, which is why nothing read back from it says anything about the event's own.
  readonly detail: SyncDetailLevel;
  readonly event: ProviderEventWrite;
}

export type OutboundStep =
  // No copy is out, or the last attempt never got an answer.
  | {
      readonly action: "create";
      readonly desired: OutboundDesired;
      readonly link: SyncLinkRow | null;
    }
  // A copy is out and the event has changed since it was sent.
  | { readonly action: "update"; readonly desired: OutboundDesired; readonly link: SyncLinkRow }
  // A copy is out and should not be: the event was cancelled or left the window, the rule was
  // removed, the firm closed the type, or the rule now names another calendar (in which case a
  // create for the new place follows on the next pass).
  | { readonly action: "remove"; readonly link: SyncLinkRow };

function joinLines(lines: readonly (string | null)[]): string | null {
  const kept = lines.filter((line): line is string => line !== null && line !== "");
  return kept.length === 0 ? null : kept.join("\n\n");
}

function repeatOf(row: SyncCandidateRow): ProviderEventRepeat | null {
  if (row.recurrence_rule === null) return null;
  const skippedDays =
    row.replaced_days === null || row.replaced_days === ""
      ? []
      : [...new Set(row.replaced_days.split(","))].toSorted();
  return { line: row.recurrence_rule, rule: parseRecurrence(row.recurrence_rule), skippedDays };
}

// The event as it leaves, at the detail the firm allows.
//
// `minimal` carries the type's name and the matter number and nothing a client said or did: no
// title, no notes, no place. A matter with no number yet leaves as its type alone.
//
// A deadline always takes the whole day. A deadline with a time is one a court set to the minute,
// and the minute is written into the title so it reads correctly on a day view that shows no notes.
export function providerEventFor(
  candidate: OutboundCandidate,
  detail: SyncDetailLevel,
): ProviderEventWrite {
  const row = candidate.row;
  const isDeadline = candidate.localKind === "deadline";
  const kindName = isDeadline ? "Deadline" : (row.type_name ?? "Event");
  const matterSuffix = row.matter_number === null ? "" : ` (${row.matter_number})`;
  const dueTime = isDeadline && row.starts_at_time !== null ? ` at ${row.starts_at_time}` : "";
  const repeat = isDeadline ? null : repeatOf(row);
  const title =
    detail === "minimal"
      ? `${kindName}${matterSuffix}${dueTime}`
      : isDeadline
        ? `Deadline: ${row.title}${dueTime}`
        : row.title;
  return {
    title,
    notes:
      detail === "minimal"
        ? null
        : joinLines([
            row.description,
            row.conference_url,
            row.matter_number === null ? null : `Matter ${row.matter_number}`,
          ]),
    location: detail === "minimal" ? null : row.location_text,
    startsOn: row.starts_on,
    startsAtTime: isDeadline ? null : row.starts_at_time,
    endsOn: row.ends_on,
    endsAtTime: isDeadline ? null : row.ends_at_time,
    timeZone: row.time_zone,
    // Left off altogether for an event that happens once, so the shape of what is sent for one is
    // what it always was.
    ...(repeat === null ? {} : { repeats: repeat }),
  };
}

// The text a digest is taken over. Field order is fixed here and nowhere else, so two passes over
// an unchanged event always produce the same text.
export function agreedText(desired: OutboundDesired): string {
  const event = desired.event;
  return JSON.stringify([
    desired.calendarRemoteId,
    event.title,
    event.notes,
    event.location,
    event.startsOn,
    event.startsAtTime,
    event.endsOn,
    event.endsAtTime,
    event.timeZone,
    // Appended only for a series, so the text for an event that happens once is what it was
    // before series were sent and no copy already out is written again for nothing.
    ...(event.repeats === null || event.repeats === undefined
      ? []
      : [event.repeats.line, event.repeats.skippedDays.join(",")]),
  ]);
}

function linkKey(localKind: string, localId: string): string {
  return `${localKind}:${localId}`;
}

// Everything that should be out, under the rules and limits as they stand.
export function desiredCopies(
  rules: readonly OutboundRule[],
  limitFor: (subject: string) => OutboundLimit,
  candidates: readonly OutboundCandidate[],
): OutboundDesired[] {
  const ruleBySubject = new Map(rules.map((rule) => [rule.subject, rule]));
  const desired: OutboundDesired[] = [];
  for (const candidate of candidates) {
    const rule = ruleBySubject.get(candidate.row.subject);
    if (rule === undefined) continue;
    const limit = limitFor(candidate.row.subject);
    // A rule cannot be saved for a closed subject and closing one deletes its rules, so this is
    // the third lock on the same door: a pass never sends what the firm does not let leave, even
    // if a rule somehow outlived the limit.
    if (!limit.mayLeave) continue;
    const inScope =
      candidate.row.takes_part === 1 ||
      (rule.scope === "my_matters" && candidate.row.on_own_matter === 1);
    if (!inScope) continue;
    desired.push({
      localKind: candidate.localKind,
      localId: candidate.row.id,
      calendarRemoteId: rule.calendarRemoteId,
      detail: limit.detail,
      event: providerEventFor(candidate, limit.detail),
    });
  }
  return desired;
}

// The difference between what should be out and what is. `digestOf` is handed in because taking a
// digest needs the runtime's own primitive and this module calls nothing.
export async function planOutbound(
  desired: readonly OutboundDesired[],
  links: readonly SyncLinkRow[],
  digestOf: (text: string) => Promise<string>,
): Promise<{ steps: OutboundStep[]; digests: Map<OutboundDesired, string> }> {
  const linkByKey = new Map(links.map((link) => [linkKey(link.local_kind, link.local_id), link]));
  const wanted = new Set<string>();
  const steps: OutboundStep[] = [];
  const digests = new Map<OutboundDesired, string>();
  for (const copy of desired) {
    const key = linkKey(copy.localKind, copy.localId);
    wanted.add(key);
    const digest = await digestOf(agreedText(copy));
    digests.set(copy, digest);
    const link = linkByKey.get(key);
    if (link === undefined) {
      steps.push({ action: "create", desired: copy, link: null });
    } else if (link.calendar_remote_id !== copy.calendarRemoteId) {
      // The rule moved to another calendar. The copy in the old one goes now; with its link gone,
      // the next pass creates the copy in the new one.
      steps.push({ action: "remove", link });
    } else if (link.remote_event_id === null) {
      // Asked for and never answered, or refused. A refusal is tried again only once the event
      // has changed, since sending the same thing would be refused the same way.
      if (link.state === "pending" || link.agreed_hash !== digest) {
        steps.push({ action: "create", desired: copy, link });
      }
    } else if (link.agreed_hash !== digest) {
      steps.push({ action: "update", desired: copy, link });
    }
  }
  for (const link of links) {
    if (!wanted.has(linkKey(link.local_kind, link.local_id)))
      steps.push({ action: "remove", link });
  }
  // Removals first: a pass that is cut short has then taken back what should not be out before it
  // has sent anything new.
  steps.sort((left, right) => Number(right.action === "remove") - Number(left.action === "remove"));
  return { steps, digests };
}
