/*
 * The conflicts report — what the firm hands a court, opposing counsel, or its own file.
 *
 * A firm served with a disqualification motion has to defend the sentence its system produced. It
 * can defend a PROCEDURE: these channels ran, at this band, over this many entities; this source
 * has no corpus behind it; the traversal stopped here and this much was reachable and not searched;
 * these candidates surfaced; this named person answered each one and this is what they said. It
 * cannot defend a conclusion the platform drew for it. So everything on this paper is either a fact
 * about the search, taken verbatim from the check's own recorded row, or a named human's own words.
 *
 * NOTHING HERE SUMMARIZES THE STATEMENT. The engine writes the account of its own search sentence
 * by sentence; the report prints those sentences in the order they were written. Rewriting them
 * would be this surface putting words in the platform's mouth, and the sentence's whole value is
 * that it came from the machine that ran the search.
 *
 * A WAIVER IS THE ONE ANSWER THAT CITES SOMETHING OUTSIDE THIS SYSTEM, SO THE PAPER CARRIES IT AND
 * CARRIES ITS GAPS. Everything else a reviewer concludes is complete in their own sentence. A waiver
 * points at a client's informed consent, confirmed in writing, that the firm will be asked to
 * produce — so the sheet states who consented, whether the consent was confirmed in writing, the
 * filed document evidencing it, and when it was given, and where the platform holds less than that
 * it says so on the same page. A report that printed an unevidenced waiver identically to an
 * evidenced one would be the platform helping a firm overstate its own record, which is the one
 * thing a defensible record cannot do.
 *
 * WHY A HANDLE MAY APPEAR WHERE A NAME BELONGS. The log records which Directory entity matched, and
 * nothing yet reads many entity names in one request. On a screen a raw handle is useless to a
 * reader and is never printed; on a record of procedure it is the citable thing the log actually
 * holds, so the report prints the name it knows and the handle when it does not. A blank there
 * would be the one thing a defensible record cannot contain.
 */
import { formatInstant, personName } from "@magna-carta/design-system/formatters";
import type {
  PrintSheetDocument,
  PrintSheetField,
  PrintSheetSection,
} from "@magna-carta/design-system/print-sheet/projection";
import type { CheckWithHits, HitDetail } from "./conflicts-api.ts";
import {
  adjudicationSummary,
  edgeTypeLabel,
  evidenceTier,
  pathSummary,
  sourceVocabulary,
  strictnessVocabulary,
  triggerVocabulary,
  waiverShortfallText,
} from "./conflicts-vocabulary.ts";
import { entityKindText, surfacedAgainstText } from "./hit-columns.ts";

/** What a sheet needs that the record itself does not carry. */
export interface ReportContext {
  /**
   * The number the firm refers to the check by, and which run of it this is. The record is one
   * run's account; the number is the check's, so it arrives with the context rather than the row.
   * Absent, the run's handle prints — the citable thing the log holds when nothing better is known.
   */
  readonly checkNumber?: string;
  readonly runOrdinal?: number;
  /** Directory names resolved so far, by entity handle. Missing means the handle prints. */
  readonly entityNames?: ReadonlyMap<string, string>;
  /** Member names by user handle, for the reviewer on an answer and the actor on a check. */
  readonly memberNames?: ReadonlyMap<string, string>;
  readonly printedAt: Date;
}

/** How a party reads on paper: the name where one is known, and the stored handle where not. */
export function reportedParty(entityId: string, names?: ReadonlyMap<string, string>): string {
  const name = names?.get(entityId);
  return name === undefined || name.trim() === "" ? entityId : name;
}

/*
 * A HIT's party reads off the hit itself, which the server resolves for every hit of the check.
 * Before that, the sheet could only name a party a reviewer had opened — every other candidate
 * printed as a handle, on the document a firm hands a court. The map is still consulted, because a
 * waiver's consenting party is a different entity and is still read one at a time.
 */
export function reportedHitParty(hit: HitDetail, names?: ReadonlyMap<string, string>): string {
  const name = hit.party?.displayName;
  if (name !== undefined && name !== null && name.trim() !== "") return name;
  return reportedParty(hit.entityId, names);
}

function memberText(userId: string | null, names?: ReadonlyMap<string, string>): string {
  if (userId === null) return "No acting member recorded";
  return personName(names?.get(userId) ?? null, { whenUnrecorded: userId });
}

function yesOrNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function countText(value: number | null): string {
  return value === null ? "Not recorded" : String(value);
}

/** The scope the check actually ran under, stated so a reader never has to know what the word meant. */
function scopeFields(check: CheckWithHits["check"]): PrintSheetField[] {
  const fields: PrintSheetField[] = [
    { label: "Name Matching", value: strictnessVocabulary(check.strictness).label },
    { label: "Raised To The Firm's Floor", value: yesOrNo(check.floorRaised) },
  ];
  if (check.matching !== null) {
    fields.push(
      { label: "Name Keys Compared", value: check.matching.nameKeys.join(", ") || "Not recorded" },
      {
        label: "Phonetic Encoders",
        value: check.matching.phoneticSchemes.join(", ") || "Not recorded",
      },
      {
        label: "Name Roles Compared",
        // Null is a stronger statement than a list naming them all: a role the firm adds later is
        // covered by the first and not by the second.
        value:
          check.matching.nameRoles === null
            ? "Every role the corpus holds"
            : check.matching.nameRoles.join(", "),
      },
      { label: "Trigram Matching", value: check.matching.trigramMatching ? "On" : "Off" },
    );
  }
  if (check.traversal === null) {
    fields.push({ label: "Traversal Budget", value: `${String(check.depth)} hops (widest class)` });
  } else if (check.traversal.followedToClosure) {
    // A walk to closure has no budget to print; what it has is how far the longest chain ran, and
    // the platform's ceiling, which is the only bound there was.
    fields.push(
      { label: "Relationships", value: "Every recorded relationship, followed to closure" },
      {
        label: "Longest Chain Followed",
        value: countText(check.traversal.longestPathLength),
      },
      { label: "The Platform's Ceiling", value: countText(check.traversal.closureCap) },
      { label: "Traversal Truncated", value: yesOrNo(check.traversal.truncated) },
    );
  } else {
    // A run from before the walk went to closure ran under the firm's hop budgets of the day, and
    // the paper says so: that is what it did.
    const budgets = Object.entries(check.traversal.edgeClassBudgets)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([edgeClass, budget]) => `${edgeClass} ${String(budget)}`)
      .join(", ");
    fields.push(
      { label: "Traversal Budget", value: `${String(check.depth)} hops (widest class)` },
      { label: "Per-Class Budgets", value: budgets === "" ? "Not recorded" : budgets },
      { label: "Closure Cap", value: countText(check.traversal.closureCap) },
      { label: "Traversal Truncated", value: yesOrNo(check.traversal.truncated) },
    );
  }
  if (check.traversal !== null) {
    if (check.traversal.truncated) {
      fields.push(
        { label: "Entities Reached", value: countText(check.traversal.entitiesReached) },
        {
          label: "Reachable And Not Searched",
          value: countText(check.traversal.unexploredFrontierSize),
        },
        {
          label: "Matched But Not Expanded",
          value: countText(check.traversal.unexpandedReachedCount),
        },
      );
    }
  }
  if (check.candidates !== null) {
    fields.push(
      { label: "Record Bound", value: countText(check.candidates.candidateCap) },
      { label: "Candidate Set Truncated", value: yesOrNo(check.candidates.truncated) },
    );
    if (check.candidates.truncated) {
      fields.push(
        { label: "Candidates Surfaced", value: countText(check.candidates.candidatesSurfaced) },
        { label: "Candidates Recorded", value: countText(check.candidates.candidatesWritten) },
        {
          label: "Candidates Refused",
          value: `${countText(check.candidates.candidatesRefused)} (${check.candidates.refusedByTier
            .map((entry) => `tier ${String(entry.tier)}: ${String(entry.count)}`)
            .join(", ")})`,
        },
      );
    }
  }
  return fields;
}

/** Every registered source, whether it ran, and — where it did not — that it did not. */
function sourceFields(check: CheckWithHits["check"]): PrintSheetField[] {
  return Object.entries(check.scope)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([source, availability]) => ({
      label: sourceVocabulary(source).label,
      value: availability === "searched" ? "Searched" : "Not searched",
    }));
}

/** One candidate, with why it surfaced and what a named person said about it. */
function hitSection(hit: HitDetail, index: number, context: ReportContext): PrintSheetSection {
  const answer = hit.disposition;
  const fields: PrintSheetField[] = [
    { label: "Party", value: reportedHitParty(hit, context.entityNames) },
    { label: "Kind", value: entityKindText(hit.entityId) || "Not recorded" },
    { label: "Source", value: sourceVocabulary(hit.sourceClass).label },
    { label: "Matched On", value: hit.matchedFields.join("; ") || "No channel recorded" },
    { label: "Reached Through", value: pathSummary(hit.graphPath) },
    { label: "Surfaced Against", value: surfacedAgainstText(hit) },
    { label: "Adjudication", value: adjudicationSummary(answer).label },
  ];
  if (answer !== null) {
    fields.push(
      { label: "Reviewer", value: memberText(answer.reviewerUserId, context.memberNames) },
      { label: "Answered", value: formatInstant(answer.createdAt) },
      { label: "Rationale", value: answer.rationale },
    );
  }
  if (answer !== null && answer.kind === "waiver_obtained") {
    const waiver = answer.waiver;
    fields.push(
      {
        label: "Waiver Given By",
        value:
          waiver === null || waiver.givenByEntityId === null
            ? "Not recorded"
            : reportedParty(waiver.givenByEntityId, context.entityNames),
      },
      {
        label: "Consent Confirmed In Writing",
        // Three answers, not two. "Not recorded" is a row that predates the question; "No" is a
        // reviewer who answered it. Printing them the same way would flatter the first.
        value:
          waiver === null || waiver.confirmedInWriting === null
            ? "Not recorded"
            : yesOrNo(waiver.confirmedInWriting),
      },
      {
        label: "Evidencing Document",
        value: waiver?.documentFileId ?? "Not filed",
      },
      { label: "Waiver Given On", value: waiver?.givenOn ?? "Not recorded" },
    );
    if (answer.shortfalls.length > 0) {
      fields.push({
        label: "What This Record Is Short Of",
        value: answer.shortfalls.map((shortfall) => waiverShortfallText(shortfall)).join(" "),
      });
    }
  }
  if (hit.graphPath.length > 0) {
    fields.push({
      label: "Path",
      value: hit.graphPath
        .map(
          (step) =>
            `${edgeTypeLabel(step.edgeType)}${step.expiredAtCheck === true ? " (ended)" : ""}`,
        )
        .join(" → "),
    });
  }
  return {
    id: hit.id,
    kind: "fields",
    title: `${String(index + 1)}. ${evidenceTier(hit.evidenceTier).label}`,
    fields,
  };
}

/** The whole check, on paper: the procedure, what it searched, and every candidate with its answer. */
export function checkReportSheet(
  result: CheckWithHits,
  context: ReportContext,
): PrintSheetDocument {
  const { check, report, hits } = result;
  const sections: PrintSheetSection[] = [
    // The engine's own account, one printed section per part, in the order it wrote them.
    ...report.map((part): PrintSheetSection => ({
      id: `search-${part.key}`,
      kind: "text",
      title: part.heading,
      text: part.lines.join("\n"),
    })),
    {
      id: "run",
      kind: "fields",
      title: "The Run",
      fields: [
        ...(context.runOrdinal === undefined
          ? []
          : [{ label: "Run", value: `Run ${String(context.runOrdinal)} of this check` }]),
        { label: "Ran", value: formatInstant(check.createdAt) },
        { label: "Trigger", value: triggerVocabulary(check.trigger).label },
        { label: "Run By", value: memberText(check.actorUserId, context.memberNames) },
        { label: "Subject Parties", value: String(check.subjectEntityIds.length) },
        { label: "Matter", value: check.matterId ?? "No matter named" },
      ],
    },
    { id: "scope", kind: "fields", title: "Scope In Force", fields: scopeFields(check) },
    { id: "sources", kind: "fields", title: "Sources", fields: sourceFields(check) },
    ...hits.map((hit, index) => hitSection(hit, index, context)),
  ];
  return {
    heading: "Conflicts Check Report",
    reference: context.checkNumber ?? check.id,
    subtitle: check.matterId ?? "Firm-wide search",
    sections,
    footer: `Magna Carta · printed ${formatInstant(context.printedAt)}`,
  };
}

/** One candidate, on paper, for a reviewer who wants the single hit in the file. */
export function hitSheet(
  hit: HitDetail,
  context: {
    readonly partyName: string | null;
    /** The name of the entity that gave the waiver, where one read has answered it. */
    readonly consentingPartyName?: string | null;
    readonly reviewerName: string | null;
    readonly checkInstant: string;
    readonly printedAt: Date;
  },
): PrintSheetDocument {
  const names = new Map<string, string>();
  if (context.partyName !== null) names.set(hit.entityId, context.partyName);
  const consentingPartyId = hit.disposition?.waiver?.givenByEntityId ?? null;
  if (consentingPartyId !== null && context.consentingPartyName != null) {
    names.set(consentingPartyId, context.consentingPartyName);
  }
  const memberNames = new Map<string, string>();
  if (hit.disposition !== null && context.reviewerName !== null) {
    memberNames.set(hit.disposition.reviewerUserId, context.reviewerName);
  }
  const section = hitSection(hit, 0, {
    entityNames: names,
    memberNames,
    printedAt: context.printedAt,
  });
  return {
    heading: "Conflicts Candidate",
    reference: hit.id,
    subtitle: `Surfaced ${formatInstant(context.checkInstant)}`,
    sections: [{ ...section, title: evidenceTier(hit.evidenceTier).label }],
    footer: `Magna Carta · printed ${formatInstant(context.printedAt)}`,
  };
}
