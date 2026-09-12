/*
 * What the New Check panel is holding, and what it composes into — kept apart from the panel that
 * draws it, so both halves can be reasoned about and tested without a browser.
 *
 * THE PANEL HAS TWO PANES AND ONE DRAFT. The left pane asks who the check is about; the right pane
 * says where it searches and how it compares names. They are separate components on the same
 * values, which only works because the values are here rather than inside either of them.
 * Everything the commit needs — the request, why it cannot be sent yet, and whether there is
 * anything to lose on the way out — is derived from those values by the functions below, so no pane
 * can hold a request from one keystroke beside a refusal from another.
 *
 * A CHECK IS ASKED FOR BY PLACE (owner's direction, 2026-09-11): the Directory, the firm's files, its
 * messaging, its Magnus conversations. The record stores technique keys — party, graph, imputation,
 * content — and the crossing between the two is `sourcesFor` below, over the location catalogue in
 * conflicts-vocabulary.ts. Only the Directory can be searched today; the other places stand on the
 * panel disabled, marked Soon, and the check records them as not searched.
 *
 * NOTHING HERE LIMITS THE SEARCH. The panel used to carry a hop budget per kind of relationship and
 * two caps, and the owner removed them: a check follows every recorded relationship to closure, and
 * the one bound on a run is the platform's, not a setting. So the draft holds no number at all.
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
 * only thing anybody has is a name said over the telephone. And a check can be filed on a matter
 * later, from its own screen, which is the ordinary case.
 */
import { permissionRefusal } from "$lib/access/refusal.ts";
import {
  RUN_CHECK_PERMISSION,
  type ConflictsTrigger,
  type RunCheckRequest,
  type SourceClass,
  type Strictness,
} from "./conflicts-api.ts";
import { strictnessVocabulary } from "./conflicts-vocabulary.ts";

/** Everything the two panes hold between them. Plain values, so this module needs no browser. */
export interface CheckDraftValues {
  /** The Directory entities the check is about. */
  readonly subjectEntityIds: readonly string[];
  /** Whether the Directory search walks out through recorded relationships. */
  readonly searchRelationships: boolean;
  /** Whether it joins the firm's own people against the matter's parties. Needs a matter. */
  readonly searchOwnPeople: boolean;
  readonly nameMatching: Strictness;
}

/**
 * A matter as the panel's matter field holds it: enough to file the check and to decide the
 * trigger, and nothing the field did not itself show. The field offers matters from two reads — the
 * ones a chosen party is on, and a search over the docket — so it holds the shape both can supply
 * rather than the docket's own summary.
 */
export interface ChosenMatter {
  readonly id: string;
  /** Null on a consultation the firm has not taken on, which is what decides the trigger. */
  readonly matterNumber: string | null;
  readonly title: string;
}

/** How a matter reads in a field: its number where it has one. */
export function chosenMatterLine(matter: ChosenMatter): string {
  return matter.matterNumber === null ? matter.title : `${matter.matterNumber} · ${matter.title}`;
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
};

/**
 * Which trigger this check is filed under.
 *
 * Derived, never asked — see the head of this file. Both words name the same search; they differ
 * only in where the file stood when it ran.
 */
export function triggerFor(surface: CheckSurface): ConflictsTrigger {
  return surface.matterId !== null && surface.matterEngaged ? "comprehensive" : "preliminary";
}

/**
 * The sources this check asks for — the technique keys the Directory's specifics stand over. Party
 * is the firm-wide floor and is never a choice. No other place can be searched yet, so no other
 * place's source is ever asked for; the engine records those places as not searched on its own.
 */
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
      },
    },
  };
}

/**
 * Why the check cannot be asked for yet.
 *
 * Every reason is a fact about a FIELD — a permission the account lacks, nobody named — so it is
 * composed beside the fields rather than in the panel that renders the commit, which has no
 * business knowing what the fields are.
 */
function refusalFor(values: CheckDraftValues, surface: CheckSurface): string | null {
  if (surface.permissions !== null && !surface.permissions.includes(RUN_CHECK_PERMISSION)) {
    return permissionRefusal("Running a check", RUN_CHECK_PERMISSION);
  }
  // A matter brings its own parties, so a check filed against one may name none of its own.
  if (values.subjectEntityIds.length === 0 && surface.matterId === null) {
    return "Name at least one party.";
  }
  return null;
}

/** Whether anything has moved off its opening value. A panel with nothing to lose never asks. */
function hasBeenTouched(values: CheckDraftValues): boolean {
  return (
    values.subjectEntityIds.length > 0 ||
    values.searchRelationships !== OPENING_DRAFT.searchRelationships ||
    values.searchOwnPeople !== OPENING_DRAFT.searchOwnPeople ||
    values.nameMatching !== OPENING_DRAFT.nameMatching
  );
}

// ---- what the panel says the check will do ----------------------------------------------------

/**
 * The check these values describe, in sentences.
 *
 * Every control in the right pane is a fact about a search nobody can see, and a reader who does
 * not already know what a relationship walk is cannot tell what pressing Run will do. So the panel
 * says it, in the left pane, beside the parties — and it says it from the SAME values the request
 * is composed from, so it can never describe a search other than the one that runs. Each sentence
 * is a fact about the SEARCH, never about the matter.
 */
export function checkPlan(values: CheckDraftValues, surface: CheckSurface): string[] {
  const sentences: string[] = [];

  sentences.push(
    "Searches every party in the firm's Directory for names and identifiers like the ones named.",
  );

  sentences.push(
    values.searchRelationships
      ? "Follows every recorded relationship out from each party, as far as the chain goes."
      : "Does not follow recorded relationships.",
  );

  if (surface.matterId === null) {
    sentences.push(
      "Cannot reach the firm's own people, because no matter is named, and records that as not searched.",
    );
  } else if (values.searchOwnPeople) {
    sentences.push("Joins the firm's own people against the matter's parties, by identity.");
  } else {
    sentences.push("Does not join the firm's own people against the matter's parties.");
  }

  sentences.push(
    `Compares names at ${strictnessVocabulary(values.nameMatching).label.toLowerCase()}, which includes names that sound alike.`,
  );

  sentences.push("Records Files, Messaging and Magnus as not searched: nothing indexes them yet.");

  sentences.push(
    triggerFor(surface) === "comprehensive"
      ? "Goes into the firm's log as a comprehensive check: the firm has taken this matter on."
      : "Goes into the firm's log as a preliminary check: the screen before the firm takes a matter on.",
  );

  return sentences;
}
