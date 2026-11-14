/*
 * What a merge is about to do, worked out before it is done.
 *
 * A merge folds one record into another. In the firm's record it is not a deletion — the folded
 * record is archived, its names stay in the search and conflicts corpus and resolve to the
 * survivor, and every inbound reference is repointed. In the SCREEN's terms it is irreversible:
 * nothing in the product undoes it, because once work accrues against the joined record there is no
 * honest way to say which side a later reference belonged to. That is the sentence the confirmation
 * has to carry, and it is why this model exists at all — the plan is computed, shown, and only then
 * sent.
 *
 * The plan is a pure function of the two records. Rendering it is the dialog's job; deciding what it
 * says is this module's, so the thing a person reads before an irreversible act is the same thing
 * that is sent.
 */
import type {
  DirectoryEntityDetail,
  DirectoryEntityKind,
  DirectoryOrganizationDetail,
  DirectoryPersonDetail,
} from "./directory-api.ts";
import { directoryEntityName, entityDetailIdentifier } from "./entity-presentation.ts";

/** Which record a field's value comes from once the merge lands. */
export type MergeFieldChoice = "master" | "subordinate";

/**
 * One field the two records could disagree about.
 *
 * `column` is the node-table column the contract's survivorship map is keyed by. It is the
 * storage's own spelling rather than the contract's field name because that is what the merge
 * endpoint accepts, and translating it anywhere but here would put the mapping in two places.
 */
export interface MergeFieldRow {
  column: string;
  label: string;
  masterValue: string | null;
  subordinateValue: string | null;
  /** True where the two records hold different values and a person therefore has to choose. */
  differs: boolean;
}

export interface MergePlan {
  kind: DirectoryEntityKind;
  masterId: string;
  subordinateId: string;
  masterName: string;
  subordinateName: string;
  /** Every survivable field, in reading order. The ones that differ are the ones to look at. */
  fields: readonly MergeFieldRow[];
  /** Why this merge cannot be performed, or null when it can. */
  refusal: string | null;
}

/** The survivable columns per kind, in the order a person reads a name. */
const PERSON_FIELDS: readonly { column: string; label: string; of: keyof DirectoryPersonDetail }[] =
  [
    { column: "name_prefix", label: "Prefix", of: "prefix" },
    { column: "name_given", label: "Given name", of: "given" },
    { column: "name_middle", label: "Middle name", of: "middle" },
    { column: "name_family", label: "Family name", of: "family" },
    { column: "name_suffix", label: "Suffix", of: "suffix" },
    { column: "display_name", label: "Display name", of: "displayName" },
  ];

const ORGANIZATION_FIELDS: readonly {
  column: string;
  label: string;
  of: keyof DirectoryOrganizationDetail;
}[] = [
  { column: "legal_name", label: "Legal name", of: "legalName" },
  { column: "display_name", label: "Display name", of: "displayName" },
];

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function fieldRows(master: DirectoryEntityDetail, subordinate: DirectoryEntityDetail) {
  if (master.kind === "person" && subordinate.kind === "person") {
    const left = master.person;
    const right = subordinate.person;
    return PERSON_FIELDS.map(({ column, label, of }) => {
      const masterValue = text(left[of]);
      const subordinateValue = text(right[of]);
      return {
        column,
        label,
        masterValue,
        subordinateValue,
        differs: masterValue !== subordinateValue,
      };
    });
  }
  if (master.kind === "organization" && subordinate.kind === "organization") {
    const left = master.organization;
    const right = subordinate.organization;
    return ORGANIZATION_FIELDS.map(({ column, label, of }) => {
      const masterValue = text(left[of]);
      const subordinateValue = text(right[of]);
      return {
        column,
        label,
        masterValue,
        subordinateValue,
        differs: masterValue !== subordinateValue,
      };
    });
  }
  return [];
}

/**
 * Why these two records cannot be merged, or null.
 *
 * Every one of these is refused by the contract too. Answering it here means the control is
 * disabled with its reason on screen rather than pressed into a server error the person could have
 * been told about first.
 */
function refusalFor(
  master: DirectoryEntityDetail,
  subordinate: DirectoryEntityDetail,
): string | null {
  if (entityDetailIdentifier(master) === entityDetailIdentifier(subordinate)) {
    return "A record can't be merged into itself.";
  }
  if (master.kind !== subordinate.kind) {
    return "A person and an organization can't be merged.";
  }
  const masterMerged =
    master.kind === "person" ? master.person.mergedIntoId : master.organization.mergedIntoId;
  if (masterMerged !== null) {
    return "The surviving record was already merged into another one. Open that record and merge there.";
  }
  const subordinateMerged =
    subordinate.kind === "person"
      ? subordinate.person.mergedIntoId
      : subordinate.organization.mergedIntoId;
  if (subordinateMerged !== null) {
    return "This record has already been folded into another one.";
  }
  return null;
}

/** The plan for folding `subordinate` into `master`. */
export function mergePlan(
  master: DirectoryEntityDetail,
  subordinate: DirectoryEntityDetail,
): MergePlan {
  return {
    kind: master.kind,
    masterId: entityDetailIdentifier(master),
    subordinateId: entityDetailIdentifier(subordinate),
    masterName: directoryEntityName(master),
    subordinateName: directoryEntityName(subordinate),
    fields: fieldRows(master, subordinate),
    refusal: refusalFor(master, subordinate),
  };
}

/**
 * The survivorship map the merge endpoint takes: only the fields a person chose to take from the
 * folded record. A field left at the survivor's own value is absent rather than sent as "master",
 * which is what the contract expects and what keeps the recorded merge event a record of the
 * choices that were actually made.
 */
export function survivorshipFrom(
  plan: MergePlan,
  choices: Readonly<Record<string, MergeFieldChoice>>,
): Record<string, "subordinate"> {
  const survivorship: Record<string, "subordinate"> = {};
  for (const field of plan.fields) {
    if (choices[field.column] === "subordinate") survivorship[field.column] = "subordinate";
  }
  return survivorship;
}

/** The default choice for every field: the survivor keeps what it holds unless somebody says otherwise. */
export function defaultMergeChoices(plan: MergePlan): Record<string, MergeFieldChoice> {
  const choices: Record<string, MergeFieldChoice> = {};
  for (const field of plan.fields) choices[field.column] = "master";
  return choices;
}

/**
 * What the merge does to everything that is not a single-valued field, in the order it matters.
 *
 * Names, identifiers, relationships and categories are not chosen between — they are multi-valued
 * and they are all kept, on the surviving record. Saying so is the difference between a person
 * understanding a merge and fearing it.
 */
export const MERGE_CONSEQUENCES: readonly string[] = [
  "The merged record is archived, not deleted. Its names and identifiers are kept.",
  "All names on both records stay searchable and open the surviving record.",
  "Matter roles, relationships, categories and identifiers all move to the surviving record.",
  "Conflicts reports that named either record can still be reproduced.",
];

/** The one sentence that has to be read before the act, stated once so no surface softens it. */
export const MERGE_IRREVERSIBLE_STATEMENT = "This can't be undone in the app.";
