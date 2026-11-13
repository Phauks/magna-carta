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
 * messaging, its tasks, its Magnus conversations. The record stores technique keys — party, graph,
 * imputation, content — and the crossing between the two is `sourcesFor` below, over the location
 * catalogue in conflicts-vocabulary.ts. Messaging, Tasks and Magnus are asked for by `placesFor`, all
 * on by default; Files stands on the panel disabled, marked Soon, and is recorded as not searched.
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
 * A CHECK DOES NOT NEED A MATTER, and the panel no longer asks for one (owner's ruling,
 * 2026-11-09). The subjects are the parties; the matter is where the check is FILED, chosen from the
 * report once somebody knows it. Firm Employees runs either way: against the matter's parties where
 * the panel was opened from a matter, and against everyone the check reached where it was not.
 */
import { permissionRefusal } from "$lib/access/refusal.ts";
import {
  RUN_CHECK_PERMISSION,
  type ConflictsTrigger,
  type MessagingChannel,
  type PlacesRequest,
  type RunCheckRequest,
  type SourceClass,
  type Strictness,
  type TaskMatterStatus,
  type FileMatterStatus,
} from "./conflicts-api.ts";

/** Everything the two panes hold between them. Plain values, so this module needs no browser. */
export interface CheckDraftValues {
  /** The Directory entities the check is about. */
  readonly subjectEntityIds: readonly string[];
  /** Whether the Directory search walks out through recorded relationships. */
  readonly searchRelationships: boolean;
  /** Whether it looks for the firm's own people, by identity. */
  readonly searchOwnPeople: boolean;
  readonly nameMatching: Strictness;
  /** Whether names are also found by trigram overlap. Over-inclusive always runs it. */
  readonly trigramMatching: boolean;
  /** The calls, texts and email to search. Empty is Messaging not asked for. */
  readonly messaging: readonly MessagingChannel[];
  /** The matter statuses whose tasks are searched. Empty is Tasks not asked for. */
  readonly tasks: readonly TaskMatterStatus[];
  /** Whether Magnus conversations are searched. */
  readonly magnus: boolean;
  /** The matter statuses whose files are searched; Archived is deleted files. Empty is Files not asked for. */
  readonly files: readonly FileMatterStatus[];
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
  trigramMatching: true,
  messaging: ["calls", "texts", "email"],
  tasks: ["consultations", "open", "closed", "archived"],
  magnus: true,
  files: ["consultations", "open", "closed", "archived"],
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
 * The sources this check asks for — the technique keys the Directory's options stand over. Party
 * is the firm-wide floor and is never a choice. The firm's own records are asked for separately, by
 * `placesFor`.
 */
export function sourcesFor(values: CheckDraftValues): SourceClass[] {
  const sources: SourceClass[] = ["party"];
  if (values.searchRelationships) sources.push("graph");
  if (values.searchOwnPeople) sources.push("imputation");
  return sources;
}

/** The calls, texts, email, tasks, Magnus conversations and files this check asks for. */
export function placesFor(values: CheckDraftValues): PlacesRequest {
  return {
    messaging: [...values.messaging],
    tasks: [...values.tasks],
    magnus: values.magnus,
    files: [...values.files],
  };
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
        sources: sourcesFor(values),
        strictness: values.nameMatching,
        ...(values.nameMatching === "balanced" && !values.trigramMatching
          ? { trigramMatching: false }
          : {}),
        places: placesFor(values),
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
    values.nameMatching !== OPENING_DRAFT.nameMatching ||
    values.trigramMatching !== OPENING_DRAFT.trigramMatching ||
    !sameMembers(values.messaging, OPENING_DRAFT.messaging) ||
    !sameMembers(values.tasks, OPENING_DRAFT.tasks) ||
    !sameMembers(values.files, OPENING_DRAFT.files) ||
    values.magnus !== OPENING_DRAFT.magnus
  );
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry) => right.includes(entry));
}
