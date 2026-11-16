import { addCalendarDays } from "@magna-carta/civil-time/civil-date";
import { readAuditChanges, type AuditChangeEntry } from "@magna-carta/data-access/audit-statements";
import type { SqlDatabase } from "@magna-carta/data-access/idempotency-statements";
import { completeScope, type ReportCompleteness } from "../completeness.ts";
import { ReportingValidationError } from "../reporting-validation.ts";
import { resolveLiveOnlyPeriod } from "../temporal.ts";

// THE CHANGE LOG — who added, changed and removed the firm's people and organizations, its matters,
// and its trust account rules, over a period. The rows are the per-firm audit log's, read through
// readAuditChanges in packages/data-access/src/audit-statements.ts, which owns that table's write.
//
// ONE AXIS, AND WHY THAT IS ENOUGH. An audit row is written in the same batch as the change it
// records and is never updated or deleted, and its `created_at` is both when the change happened and
// when the platform learned of it. There is no backdating, so there is no second axis for a knowledge
// instant to bound: a period that has already ended re-reads to the same rows forever. So the report
// takes no knowledge instant (it would be a parameter that changes nothing) and says, in its own
// statement, whether the period had ended when it was produced. The read is pinned at `computedAt`
// either way, so a change committed while the report assembles cannot reach the counts and miss the
// list. The names beside the figures are the member mirror's as they stand now.
//
// Days are UTC days: the period runs from the start of `periodStart` to the end of `periodEnd`, UTC.
//
// METADATA IS NEVER PRINTED. Each row is the event, a plain-words label for it, who made it, the
// handle of the record it was about, and when. Some events carry ids in their metadata and the
// protected-field decrypt row names a sealed field; none of that is fit for a report about people,
// and no event in these families records which fields changed, so none are shown.
//
// WHAT IS NOT HERE, said out loud. Opening a trust account, adding a ledger account and mapping the
// billing account roles write no audit row today, so the Accounts family can only count changes to
// the trust approval rule. Reading a sealed identifier is a read, not a change, and is not counted.

export type ChangeFamily = "directory" | "matters" | "accounts";

// Every event the report covers, its family and what it says in plain words. An event not named here
// is not a change to these records (a file rescan, a system matter provisioned at setup) and is left
// out; a new maintenance event joins by a line here.
export const CHANGE_LOG_EVENTS: Readonly<
  Record<string, { readonly family: ChangeFamily; readonly label: string }>
> = {
  "directory.person.created": { family: "directory", label: "Person added" },
  "directory.person.updated": { family: "directory", label: "Person details changed" },
  "directory.organization.created": { family: "directory", label: "Organization added" },
  "directory.entity.renamed": { family: "directory", label: "Name changed" },
  "directory.entity.name_corrected": { family: "directory", label: "Name corrected" },
  "directory.entity.name_added": { family: "directory", label: "Other name added" },
  "directory.entity.merged": { family: "directory", label: "Merged into another record" },
  "directory.entity.photo_changed": { family: "directory", label: "Photo changed" },
  "directory.entity.photo_removed": { family: "directory", label: "Photo removed" },
  "directory.identifier.added": { family: "directory", label: "Identifier added" },
  "directory.email.added": { family: "directory", label: "Email added" },
  "directory.email.updated": { family: "directory", label: "Email changed" },
  "directory.email.removed": { family: "directory", label: "Email removed" },
  "directory.phone.added": { family: "directory", label: "Phone number added" },
  "directory.phone.updated": { family: "directory", label: "Phone number changed" },
  "directory.phone.removed": { family: "directory", label: "Phone number removed" },
  "directory.address.added": { family: "directory", label: "Address added" },
  "directory.address.updated": { family: "directory", label: "Address changed" },
  "directory.address.removed": { family: "directory", label: "Address removed" },
  "directory.edge.created": { family: "directory", label: "Relationship added" },
  "directory.category.created": { family: "directory", label: "Category created" },
  "directory.category.assigned": { family: "directory", label: "Category assigned" },
  "directory.party_role.created": { family: "directory", label: "Party role created" },
  "directory.matter_party.linked": { family: "matters", label: "Party added to a matter" },
  "directory.matter_party.unlinked": { family: "matters", label: "Party removed from a matter" },
  "matter.created": { family: "matters", label: "Matter created" },
  "matter.updated": { family: "matters", label: "Matter details changed" },
  "matter.graduated": { family: "matters", label: "Intake moved to consultation" },
  "matter.opened": { family: "matters", label: "Matter opened" },
  "matter.held": { family: "matters", label: "Matter put on hold" },
  "matter.released": { family: "matters", label: "Matter taken off hold" },
  "matter.closed": { family: "matters", label: "Matter closed" },
  "matter.reopened": { family: "matters", label: "Matter reopened" },
  "matter.renumbered": { family: "matters", label: "Matter renumbered" },
  "matter.client_linked": { family: "matters", label: "Client linked" },
  "matter.transferred": { family: "matters", label: "Matter brought over" },
  "matter.party_transferred": { family: "matters", label: "Party brought over" },
  "matter.assignment.created": { family: "matters", label: "Team member added" },
  "matter.assignment.ended": { family: "matters", label: "Team member removed" },
  "matter.court_case.created": { family: "matters", label: "Court case added" },
  "matter.court_case.updated": { family: "matters", label: "Court case changed" },
  "matter.estate.created": { family: "matters", label: "Estate details added" },
  "matter.estate.updated": { family: "matters", label: "Estate details changed" },
  "matter.file_destruction_date.set": { family: "matters", label: "File destruction date set" },
  "matter.file_destruction_date.cleared": {
    family: "matters",
    label: "File destruction date cleared",
  },
  "trust.authorization_policy_changed": {
    family: "accounts",
    label: "Trust approval rule changed",
  },
};

export const CHANGE_FAMILY_LABELS: Readonly<Record<ChangeFamily, string>> = {
  directory: "People and organizations",
  matters: "Matters",
  accounts: "Accounts",
};

const FAMILY_ORDER: readonly ChangeFamily[] = ["directory", "matters", "accounts"];

export interface ChangeCounts {
  readonly directoryCount: number;
  readonly matterCount: number;
  readonly accountCount: number;
  readonly totalCount: number;
}

export interface ChangeLogReport {
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly computedAt: string;
  // True when the period had ended before the report was produced: the same period then always
  // returns the same rows.
  readonly reproducible: boolean;
  readonly statement: string;
  readonly completeness: ReportCompleteness;
  readonly totals: ChangeCounts;
  readonly families: readonly {
    readonly family: ChangeFamily;
    readonly label: string;
    readonly changeCount: number;
  }[];
  // Each person who made a change, most changes first; system changes (no person) last.
  readonly people: readonly ({
    readonly actorUserId: string | null;
    readonly actorName: string | null;
  } & ChangeCounts)[];
  // Every change, newest first.
  readonly entries: readonly {
    readonly id: string;
    readonly at: string;
    readonly actorUserId: string | null;
    readonly actorName: string | null;
    readonly family: ChangeFamily;
    readonly event: string;
    readonly eventLabel: string;
    readonly subjectId: string | null;
  }[];
}

class FamilyTally {
  private readonly counts: Record<ChangeFamily, number> = { directory: 0, matters: 0, accounts: 0 };

  take(family: ChangeFamily, count: number): void {
    this.counts[family] += count;
  }

  of(family: ChangeFamily): number {
    return this.counts[family];
  }

  figures(): ChangeCounts {
    return {
      directoryCount: this.counts.directory,
      matterCount: this.counts.matters,
      accountCount: this.counts.accounts,
      totalCount: this.counts.directory + this.counts.matters + this.counts.accounts,
    };
  }
}

function changeLogStatement(
  periodStart: string,
  periodEnd: string,
  computedAt: string,
  reproducible: boolean,
): string {
  const covers =
    `This report covers changes recorded from ${periodStart} to ${periodEnd} (UTC days), ` +
    `as the change history stood when it was produced, at ${computedAt}. `;
  const holds = reproducible
    ? "The period had ended, and the change history is never edited, so running the same period " +
      "again returns the same changes. "
    : "The period had not ended, so running it again later will include changes made since. ";
  return `${covers}${holds}Names are as they stood when this report was produced.`;
}

export async function assembleChangeLog(
  database: SqlDatabase,
  input: { readonly periodStart: string; readonly periodEnd: string },
  options: { readonly computedAt: string },
): Promise<ChangeLogReport> {
  const period = resolveLiveOnlyPeriod(input);
  const fromInstant = `${period.periodStart}T00:00:00.000Z`;
  const beforeInstant = `${addCalendarDays(period.periodEnd, 1)}T00:00:00.000Z`;
  const changes = await readAuditChanges(database, {
    events: Object.keys(CHANGE_LOG_EVENTS),
    fromInstant,
    beforeInstant,
    knownAtOrBefore: options.computedAt,
  });
  if (changes.truncated) {
    throw new ReportingValidationError(
      "reporting-breakdown-truncated",
      "more changes were recorded in this period than one report can list; choose a shorter period",
    );
  }

  const familyOf = (event: string): ChangeFamily => {
    const known = CHANGE_LOG_EVENTS[event];
    if (known === undefined) {
      // The read is asked for these events only, so this is a read that ignored its own filter.
      throw new Error(`the change history returned an event it was not asked for: ${event}`);
    }
    return known.family;
  };

  const totals = new FamilyTally();
  const people = new Map<string, { name: string | null; tally: FamilyTally }>();
  for (const row of changes.counts) {
    const family = familyOf(row.event);
    totals.take(family, row.count);
    const key = row.actorUserId ?? "";
    const person = people.get(key) ?? { name: row.actorName, tally: new FamilyTally() };
    person.tally.take(family, row.count);
    people.set(key, person);
  }

  const entry = (row: AuditChangeEntry) => {
    const known = CHANGE_LOG_EVENTS[row.event];
    return {
      id: row.id,
      at: row.at,
      actorUserId: row.actorUserId,
      actorName: row.actorName,
      family: familyOf(row.event),
      event: row.event,
      eventLabel: known?.label ?? row.event,
      subjectId: row.subjectId,
    };
  };

  const reproducible = beforeInstant <= options.computedAt;
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    computedAt: options.computedAt,
    reproducible,
    statement: changeLogStatement(
      period.periodStart,
      period.periodEnd,
      options.computedAt,
      reproducible,
    ),
    completeness: completeScope(),
    totals: totals.figures(),
    families: FAMILY_ORDER.map((family) => ({
      family,
      label: CHANGE_FAMILY_LABELS[family],
      changeCount: totals.of(family),
    })),
    people: [...people.entries()]
      .map(([key, person]) =>
        Object.assign(
          { actorUserId: key === "" ? null : key, actorName: person.name },
          person.tally.figures(),
        ),
      )
      .toSorted((left, right) => {
        if (left.actorUserId === null) return 1;
        if (right.actorUserId === null) return -1;
        return (
          right.totalCount - left.totalCount ||
          (left.actorName ?? "").localeCompare(right.actorName ?? "")
        );
      }),
    entries: changes.entries.map(entry),
  };
}
