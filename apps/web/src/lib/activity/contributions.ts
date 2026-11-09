/*
 * The one list of activity contributions — every subsystem that appears on the matter's Activity
 * section, registered once, beside nothing else.
 *
 * ADDING A SUBSYSTEM IS ONE LINE HERE, and the contribution itself lives beside that subsystem's
 * own web code (see contribution.ts). The pairing with the server's registry is enforced rather
 * than remembered: apps/web/test/activity-contributions.test.ts scans
 * packages/calendar/src/sources/all.ts and fails when a key it declares has no entry below, so a
 * source joining the timeline cannot reach a person's screen as an unexplained row.
 */
import { emailActivityContribution } from "./awaiting/email-activity-contribution.ts";
import type { ActivityContribution, OpenTarget } from "./contribution.ts";
import { conflictsCheckActivityContribution } from "$lib/conflicts/activity-contribution.ts";
import { costEntryActivityContribution } from "$lib/costs/activity-contribution.ts";
import {
  custodyDueBackActivityContribution,
  custodyMovementActivityContribution,
  custodyReviewDueActivityContribution,
} from "$lib/custodian/activity-contribution.ts";
import { documentAssemblyActivityContribution } from "$lib/document-assembly/activity-contribution.ts";
import {
  documentActivityContribution,
  fileHistoryActivityContribution,
} from "$lib/file-manager/activity-contribution.ts";
import type { ActivityEntry } from "$lib/matters/activity-api.ts";
import {
  firmEventActivityContribution,
  matterDeadlineActivityContribution,
  matterEventActivityContribution,
} from "$lib/matters/calendar-activity-contribution.ts";
import { matterFileDestructionActivityContribution } from "$lib/matters/matter-file-destruction-activity-contribution.ts";
import { matterLifecycleActivityContribution } from "$lib/matters/matter-lifecycle-activity-contribution.ts";
import { communicationActivityContribution } from "$lib/communications/activity-contribution.ts";
import { noteActivityContribution } from "$lib/matters/note-activity-contribution.ts";
import { taskActivityContribution } from "$lib/matters/task-activity-contribution.ts";
import { timeEntryActivityContribution } from "$lib/time/activity-contribution.ts";
import { trustMovementActivityContribution } from "$lib/trust/activity-contribution.ts";

export const ACTIVITY_CONTRIBUTIONS: readonly ActivityContribution[] = Object.freeze([
  matterEventActivityContribution,
  matterDeadlineActivityContribution,
  emailActivityContribution,
  documentAssemblyActivityContribution,
  documentActivityContribution,
  fileHistoryActivityContribution,
  noteActivityContribution,
  communicationActivityContribution,
  taskActivityContribution,
  timeEntryActivityContribution,
  costEntryActivityContribution,
  conflictsCheckActivityContribution,
  matterLifecycleActivityContribution,
  matterFileDestructionActivityContribution,
  custodyMovementActivityContribution,
  custodyReviewDueActivityContribution,
  custodyDueBackActivityContribution,
  trustMovementActivityContribution,
  firmEventActivityContribution,
]);

const BY_KEY: ReadonlyMap<string, ActivityContribution> = (() => {
  const map = new Map<string, ActivityContribution>();
  for (const contribution of ACTIVITY_CONTRIBUTIONS) {
    if (map.has(contribution.sourceKey)) {
      throw new Error(`duplicate activity contribution for ${contribution.sourceKey}`);
    }
    map.set(contribution.sourceKey, contribution);
  }
  return map;
})();

/**
 * The contribution for one source, or undefined where this build carries none.
 *
 * Undefined is answered rather than guessed at: a row from a source this build does not know is
 * shown as the plain fact that something was recorded, which is true, instead of a made-up sentence
 * that might not be. A deployed client meeting a server one release ahead is exactly that case.
 */
export function contributionFor(sourceKey: string): ActivityContribution | undefined {
  return BY_KEY.get(sourceKey);
}

/** What an entry says happened, where its source did not describe it. Honest for an unknown source. */
export function happenedText(sourceKey: string, kind: string): string {
  const contribution = contributionFor(sourceKey);
  if (contribution === undefined) return "Something was recorded on the matter";
  return typeof contribution.happened === "function"
    ? contribution.happened(kind)
    : contribution.happened;
}

/** How an entry opens: its contribution's answer, or nowhere for a source this build does not know. */
export function openTargetFor(entry: ActivityEntry): OpenTarget {
  return (
    contributionFor(entry.sourceKey)?.open(entry) ?? {
      kind: "none",
      reason: "This build does not know where this record opens",
    }
  );
}

/**
 * The Section column's whole vocabulary, in registry order, whether or not a row on screen carries
 * each word — every contribution's own section word, once.
 */
export const ACTIVITY_SECTION_VALUES: readonly string[] = [
  ...new Set(ACTIVITY_CONTRIBUTIONS.map((contribution) => contribution.section)),
];

/**
 * Every Type word the registry declares. Open vocabularies (the firm's document types) are learned
 * from the rows on top of this — a set filter offers the declared words and then whatever the rows
 * actually carry.
 */
export const ACTIVITY_TYPE_VALUES: readonly string[] = [
  ...new Set(
    ACTIVITY_CONTRIBUTIONS.flatMap((contribution) => [contribution.noun, ...contribution.types]),
  ),
];

/** The verbs the section's "+ New" control offers: every contribution that can make a record here. */
export const ACTIVITY_CREATE_VERBS = ACTIVITY_CONTRIBUTIONS.flatMap((contribution) =>
  contribution.create === undefined
    ? []
    : [{ sourceKey: contribution.sourceKey, icon: contribution.icon, ...contribution.create }],
);
