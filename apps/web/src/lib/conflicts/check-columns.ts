/*
 * The check register's declarative column model — what the platform's one table is told about the
 * conflicts checks a firm has run. Pure: it takes the firm's roster and returns columns, so what a
 * column IS has one home and one test, and the screens own only fetching and rendering.
 *
 * A ROW IS A CHECK, NOT A RUN. A check has a number, is opened once, and is run as often as the
 * firm needs; its runs belong together on the check rather than scattering as unrelated rows here.
 * So a row carries the check's number and when it was opened, and then the LATEST run's facts —
 * when it ran, where it is, what set it going, who asked, how names were compared, whether the
 * firm's floor widened it, and how many candidates came back — with how many runs there have been.
 *
 * EVERY COLUMN IS A FACT ABOUT THE SEARCH, AND NONE IS A CONCLUSION. A row does not say what any
 * of that meant, because that is a named reviewer's answer recorded against a hit, and it lives on
 * the check rather than in a register column.
 *
 * WHO ASKED IS THREE DIFFERENT ANSWERS, NOT A NAME OR A BLANK. A manual run is somebody's act and
 * names them; an event- or clock-driven run is nobody's and says so; a row written before the
 * source column existed cannot say either, and prints the gap rather than guessing at one of the
 * first two. Collapsing the last two would claim the firm's own system caught something that
 * somebody may in fact have clicked.
 *
 * WHY THERE IS NO MATTER COLUMN. A check summary carries the matter's HANDLE and no name, and the
 * matters listing has no read that takes a set of handles — so a Matter column would be one request
 * per row, which is the N+1 every listing in this product is written to avoid. What the register
 * can say honestly from the summary alone is whether the check is filed on a matter at all, which
 * is the pre-engagement screen told apart from the engagement one. The matter itself is named on
 * the check, one read away.
 */
import type { GridColumn } from "@magna-carta/design-system/data-table";
import { personName } from "@magna-carta/design-system/formatters";
import type { ConflictsCheckSummary, SubjectParty } from "./conflicts-api.ts";
import {
  NAME_MATCHING_LABEL,
  RUN_STATUS_VOCABULARY,
  runStatusVocabulary,
  strictnessVocabulary,
  triggerVocabulary,
  TRIGGER_VOCABULARY,
} from "./conflicts-vocabulary.ts";

/** What a check's actor handle resolves to, by handle. */
export interface CheckRegisterVocabulary {
  memberNames: ReadonlyMap<string, string>;
}

/** An empty vocabulary — what a screen holds before the firm's roster lands. */
export const EMPTY_CHECK_VOCABULARY: CheckRegisterVocabulary = { memberNames: new Map() };

/** Build the lookup the column model needs from the roster read. */
export function checkRegisterVocabulary(
  members: readonly { userId: string; displayName: string }[],
): CheckRegisterVocabulary {
  return { memberNames: new Map(members.map((member) => [member.userId, member.displayName])) };
}

/** What the register reads for a run nobody started: the firm's own system did, on an event or the clock. */
export const RAN_AUTOMATICALLY = "Run automatically";

/** What the register reads for a row written before the trigger source was recorded. */
export const SOURCE_UNRECORDED = "The row does not say what started it";

/** A check filed on a matter, and one run over named parties with no matter behind it. */
export const AGAINST_A_MATTER = "A matter";
export const AGAINST_NAMED_PARTIES = "Named parties";

/** The scope the search ran under: what the firm's floor required, or exactly what was asked for. */
export const FLOOR_RAISED = "Raised to the firm minimum";
export const FLOOR_AS_ASKED = "As asked";

/** Who asked for one check's latest run, as the register prints it. */
export function checkActorText(
  check: ConflictsCheckSummary,
  vocabulary: CheckRegisterVocabulary,
): string {
  if (check.triggerSource === null) return SOURCE_UNRECORDED;
  if (check.triggerSource !== "manual") return RAN_AUTOMATICALLY;
  return personName(vocabulary.memberNames.get(check.actorUserId ?? "") ?? null, {
    whenUnrecorded: check.actorUserId ?? "a member",
  });
}

/**
 * How one party a check was asked about reads. Never blank: an entity the Directory no longer
 * resolves and a record with no name are each said to be what they are.
 */
export function subjectPartyText(subject: SubjectParty): string {
  if (subject.party === null) return "Entity not resolved";
  const name = subject.party.displayName?.trim() ?? "";
  return name.length > 0 ? name : "Unnamed record";
}

/** Who a check searched, as one line: the names, in the order they were asked about. */
export function subjectPartiesText(parties: readonly SubjectParty[]): string | null {
  return parties.length === 0 ? null : parties.map(subjectPartyText).join(", ");
}

/** Where a check's latest run is, as a word. Null on a check with no run recorded, which sorts last. */
export function checkRunStateText(check: ConflictsCheckSummary): string | null {
  return check.runStatus === null ? null : runStatusVocabulary(check.runStatus).label;
}

/**
 * The register's columns. Sorting, the per-column filters, show/hide, reorder, pinning and resize
 * are the grid's; this only declares what each column is.
 *
 * The check's number anchors the row: it is how a check is referred to, and a log that could lose
 * it is one nobody can cite from. Trigger, Asked By, Against, Band, Floor and Run State take the
 * SET filter — each is a small closed vocabulary in practice, and a person narrows a log by picking
 * the word they mean rather than typing it. Trigger and Run State declare their own values so a
 * catalogue word the loaded rows happen not to carry is still offered.
 */
export function conflictsCheckColumns(
  vocabulary: CheckRegisterVocabulary,
): GridColumn<ConflictsCheckSummary>[] {
  return [
    {
      id: "checkNumber",
      label: "Check",
      anchored: true,
      value: (check) => check.checkNumber,
    },
    {
      id: "parties",
      label: "Parties",
      // Who the check is about is how a log is searched by eye, so it stands next to the number.
      value: (check) => subjectPartiesText(check.subjectParties),
    },
    {
      id: "createdAt",
      label: "Opened",
      type: "date",
      value: (check) => check.createdAt,
    },
    {
      id: "latestRunAt",
      label: "Last Run",
      type: "date",
      value: (check) => check.latestRunAt,
    },
    {
      id: "runCount",
      label: "Runs",
      type: "number",
      value: (check) => check.runCount,
    },
    {
      id: "runState",
      label: "Run State",
      filter: "set",
      filterValues: Object.values(RUN_STATUS_VOCABULARY).map((entry) => entry.label),
      value: checkRunStateText,
    },
    {
      id: "trigger",
      label: "Trigger",
      filter: "set",
      // The word, not the enum: the set filter offers what the column shows, and a person filters
      // on "New Party", never on `new_party`.
      filterValues: Object.values(TRIGGER_VOCABULARY).map((entry) => entry.label),
      value: (check) => (check.trigger === null ? null : triggerVocabulary(check.trigger).label),
    },
    {
      id: "actor",
      label: "Asked By",
      filter: "set",
      value: (check) => checkActorText(check, vocabulary),
    },
    {
      id: "against",
      label: "Against",
      filter: "set",
      filterValues: [AGAINST_A_MATTER, AGAINST_NAMED_PARTIES],
      value: (check) => (check.matterId === null ? AGAINST_NAMED_PARTIES : AGAINST_A_MATTER),
    },
    {
      id: "strictness",
      label: NAME_MATCHING_LABEL,
      filter: "set",
      value: (check) =>
        check.strictness === null ? null : strictnessVocabulary(check.strictness).label,
    },
    {
      id: "floorRaised",
      label: "Minimum",
      filter: "set",
      filterValues: [FLOOR_RAISED, FLOOR_AS_ASKED],
      // Worth a column of its own: it explains a result set wider than whoever asked expected.
      value: (check) =>
        check.floorRaised === null ? null : check.floorRaised ? FLOOR_RAISED : FLOOR_AS_ASKED,
    },
    {
      id: "hitCount",
      label: "Candidates",
      type: "number",
      // What the search SURFACED, which is not what anybody concluded about it. A count of nothing
      // is a count, and the register never grades one.
      value: (check) => check.hitCount,
    },
  ];
}

/** How the register opens: most recently opened first, which is how a log is read. */
export const CHECK_REGISTER_INITIAL_SORT = {
  columnId: "createdAt",
  direction: "descending",
} as const;
