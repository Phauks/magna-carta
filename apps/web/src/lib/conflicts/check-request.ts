/*
 * What the New Check panel is holding, and what it composes into — kept apart from the panel that
 * draws it, so both halves can be reasoned about and tested without a browser.
 *
 * THE PANEL HAS TWO PANES AND ONE DRAFT. The left pane asks who the check is about; the right pane
 * sets how widely the engine searches. They are separate components on the same values, which only
 * works because the values are here rather than inside either of them. Everything the commit needs
 * — the request, why it cannot be sent yet, and whether there is anything to lose on the way out —
 * is derived from those values by the functions below, so no pane can hold a request from one
 * keystroke beside a refusal from another.
 *
 * WHY THE TRIGGER IS DERIVED AND NOT ASKED. The two triggers a person could once choose between —
 * preliminary and comprehensive — do not change the search by one row. They name WHEN the check
 * ran: the pre-engagement screen, or the moment the firm accepted. That is a fact the record
 * already holds, so the panel reads it instead of asking a member to classify their own act, which
 * is a question with a wrong answer and no way to tell you that you gave it. A check against a
 * matter the firm has taken on is comprehensive; every other check is preliminary.
 *
 * A CHECK DOES NOT NEED A MATTER, and the shape here says so. The subjects are the parties; the
 * matter is where the check is FILED, and naming one adds that matter's own parties and lets the
 * imputation source join the firm's members against them. Without one the check runs and records
 * that source as unavailable — which is the whole point of the pre-engagement screen, where the
 * only thing anybody has is a name said over the telephone.
 *
 * A NUMBER LEFT BLANK IS THE FIRM'S OWN. Every bound below is a default rather than a floor, so a
 * blank field is not an omission — it means "whatever the firm set", and the resolved value is
 * recorded on the check either way. The firm's floor for SOURCES and name matching is different:
 * a narrower request is raised back up to it before the search runs.
 */
import { permissionRefusal } from "$lib/access/refusal.ts";
import {
  RUN_CHECK_PERMISSION,
  type BudgetedEdgeClass,
  type ConflictsTrigger,
  type FirmConflictsPolicy,
  type RunCheckRequest,
  type SourceClass,
  type Strictness,
} from "./conflicts-api.ts";
import {
  BUDGETED_EDGE_CLASSES,
  edgeClassLabel,
  strictnessVocabulary,
} from "./conflicts-vocabulary.ts";

/** The two bounds, named once so the field, the refusal and the read-back cannot disagree. */
export const RELATED_PARTY_LIMIT_LABEL = "Related parties to reach";
export const CANDIDATE_LIMIT_LABEL = "Candidates to record";

/** The hop budgets, as typed: a whole number, or nothing at all for the firm's own. */
export type HopBudgets = Readonly<Record<BudgetedEdgeClass, string>>;

/** Everything the two panes hold between them. Plain values, so this module needs no browser. */
export interface CheckDraftValues {
  /** The Directory entities the check is about. */
  readonly subjectEntityIds: readonly string[];
  /** Whether the search walks out through recorded relationships. */
  readonly searchRelationships: boolean;
  /** Whether it joins the firm's own people against the matter's parties. Needs a matter. */
  readonly searchOwnPeople: boolean;
  readonly nameMatching: Strictness;
  readonly relationshipHops: HopBudgets;
  /** The most related parties the walk may reach before it stops. Blank takes the firm's. */
  readonly relatedPartyLimit: string;
  /** The most candidates the run may write down. Blank takes the firm's. */
  readonly candidateLimit: string;
}

/** What the surface around the panel knows, and the draft does not. */
export interface CheckSurface {
  /** The matter this check is filed under, or null for a check that names none. */
  readonly matterId: string | null;
  /** Whether the firm has taken that matter on — what decides the trigger. */
  readonly matterEngaged: boolean;
  /** The signed-in member's permissions; null until the session lands. */
  readonly permissions: readonly string[] | null;
}

export interface ComposedCheck {
  /** Why the check cannot be asked for yet, or null when it can. */
  readonly refusal: string | null;
  /** The request these values compose, or null while the refusal stands. */
  readonly request: RunCheckRequest | null;
  /** Whether anything has been touched — what the panel's close guard asks before discarding. */
  readonly started: boolean;
}

/** What a panel holds the moment it opens. Also what `started` is measured against. */
export const OPENING_DRAFT: CheckDraftValues = {
  subjectEntityIds: [],
  searchRelationships: true,
  searchOwnPeople: true,
  nameMatching: "balanced",
  relationshipHops: { control: "", family: "", representation: "" },
  relatedPartyLimit: "",
  candidateLimit: "",
};

/** A number field's value as the contract wants it: a whole number, or nothing at all. */
export function boundOf(text: string): number | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/** A field holding something unusable, so the panel refuses before the server has to. */
export function malformed(text: string): boolean {
  return text.trim() !== "" && boundOf(text) === undefined;
}

/**
 * Which trigger this check is filed under.
 *
 * Derived, never asked — see the head of this file. Both words name the same search; they differ
 * only in where the file stood when it ran.
 */
export function triggerFor(surface: CheckSurface): ConflictsTrigger {
  return surface.matterId !== null && surface.matterEngaged ? "comprehensive" : "preliminary";
}

/** The sources this check asks for. Party is the firm-wide floor and is never a choice. */
export function sourcesFor(values: CheckDraftValues, surface: CheckSurface): SourceClass[] {
  const sources: SourceClass[] = ["party"];
  if (values.searchRelationships) sources.push("graph");
  if (values.searchOwnPeople && surface.matterId !== null) sources.push("imputation");
  return sources;
}

/** The refusal, the request and the close guard's answer, which always move together. */
export function composeCheck(values: CheckDraftValues, surface: CheckSurface): ComposedCheck {
  const refusal = refusalFor(values, surface);
  const started = hasBeenTouched(values);
  if (refusal !== null) return { refusal, request: null, started };

  const hops: Partial<Record<BudgetedEdgeClass, number>> = {};
  for (const edgeClass of BUDGETED_EDGE_CLASSES) {
    const budget = boundOf(values.relationshipHops[edgeClass]);
    if (budget !== undefined) hops[edgeClass] = budget;
  }
  const relatedParties = boundOf(values.relatedPartyLimit);
  const candidates = boundOf(values.candidateLimit);

  return {
    refusal: null,
    started,
    request: {
      trigger: triggerFor(surface),
      ...(surface.matterId === null ? {} : { matterId: surface.matterId }),
      subjectEntityIds: [...values.subjectEntityIds],
      scope: {
        sources: sourcesFor(values, surface),
        strictness: values.nameMatching,
        ...(Object.keys(hops).length === 0 ? {} : { edgeClassBudgets: hops }),
        ...(relatedParties === undefined ? {} : { closureCap: relatedParties }),
        ...(candidates === undefined ? {} : { candidateCap: candidates }),
      },
    },
  };
}

/**
 * Why the check cannot be asked for yet.
 *
 * Every reason is a fact about a FIELD — a permission the account lacks, nobody named, a bound that
 * is not a number — so it is composed beside the fields rather than in the panel that renders the
 * commit, which has no business knowing what the fields are.
 */
function refusalFor(values: CheckDraftValues, surface: CheckSurface): string | null {
  if (surface.permissions !== null && !surface.permissions.includes(RUN_CHECK_PERMISSION)) {
    return permissionRefusal("Running a check", RUN_CHECK_PERMISSION);
  }
  // A matter brings its own parties, so a check filed against one may name none of its own.
  if (values.subjectEntityIds.length === 0 && surface.matterId === null) {
    return "Name at least one party.";
  }
  const numeric: readonly (readonly [string, string])[] = [
    ...BUDGETED_EDGE_CLASSES.map(
      (edgeClass) => [edgeClassLabel(edgeClass), values.relationshipHops[edgeClass]] as const,
    ),
    [RELATED_PARTY_LIMIT_LABEL, values.relatedPartyLimit],
    [CANDIDATE_LIMIT_LABEL, values.candidateLimit],
  ];
  for (const [name, text] of numeric) {
    if (malformed(text)) return `${name} takes a whole number, or nothing for the firm's own.`;
  }
  return null;
}

/** Whether anything has moved off its opening value. A panel with nothing to lose never asks. */
function hasBeenTouched(values: CheckDraftValues): boolean {
  return (
    values.subjectEntityIds.length > 0 ||
    values.searchRelationships !== OPENING_DRAFT.searchRelationships ||
    values.searchOwnPeople !== OPENING_DRAFT.searchOwnPeople ||
    values.nameMatching !== OPENING_DRAFT.nameMatching ||
    BUDGETED_EDGE_CLASSES.some((edgeClass) => values.relationshipHops[edgeClass] !== "") ||
    values.relatedPartyLimit !== "" ||
    values.candidateLimit !== ""
  );
}

// ---- what the panel says the check will do ----------------------------------------------------

/**
 * The check these values describe, in sentences.
 *
 * Every setting on the right pane is a fact about a search nobody can see, and a reader who does
 * not already know what "imputation" or an edge-class budget is cannot tell what pressing Run will
 * do. So the panel says it, in the left pane, beside the parties — and it says it from the SAME
 * values the request is composed from, so it can never describe a search other than the one that
 * runs. Each sentence is a fact about the search, never about the matter.
 *
 * `policy` is the firm's own setting, so a blank field reads as the number it will actually take.
 * Null while it is being read, or where it could not be read at all, and then the sentences say
 * "the firm's own" rather than inventing a figure.
 */
export function checkPlan(
  values: CheckDraftValues,
  surface: CheckSurface,
  policy: FirmConflictsPolicy | null,
): string[] {
  const sentences: string[] = [];

  sentences.push(
    "Searches every party in the firm's Directory for names and identifiers like the ones named.",
  );

  if (values.searchRelationships) {
    const walked = BUDGETED_EDGE_CLASSES.map(
      (edgeClass) =>
        `${edgeClassLabel(edgeClass).toLowerCase()} ${hopPhrase(values.relationshipHops[edgeClass], policy?.edgeClassBudgets[edgeClass] ?? policy?.defaultDepth)}`,
    ).join(", ");
    sentences.push(
      `Walks out from each party through recorded relationships — ${walked} — and follows the whole corporate family however long the chain runs.`,
    );
  } else {
    sentences.push("Does not walk out through recorded relationships.");
  }

  if (surface.matterId === null) {
    sentences.push(
      "Cannot reach the firm's own people, because no matter is named, and records that source as not searched.",
    );
  } else if (values.searchOwnPeople) {
    sentences.push("Joins the firm's own people against the matter's parties, by identity.");
  } else {
    sentences.push("Does not join the firm's own people against the matter's parties.");
  }

  sentences.push(
    `Compares names at ${strictnessVocabulary(values.nameMatching).label.toLowerCase()}, which includes names that sound alike.`,
  );

  sentences.push(
    triggerFor(surface) === "comprehensive"
      ? "Goes into the firm's log as a comprehensive check — the firm has taken this matter on."
      : "Goes into the firm's log as a preliminary check — the screen before the firm takes a matter on.",
  );

  return sentences;
}

/** How one hop budget reads in the read-back: the number asked for, or the firm's own. */
function hopPhrase(asked: string, firmDefault: number | undefined): string {
  const budget = boundOf(asked) ?? firmDefault;
  if (budget === undefined) return "at the firm's own budget";
  return budget === 1 ? "1 hop" : `${String(budget)} hops`;
}
