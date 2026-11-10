/*
 * The New Check panel's draft — one object, two panes.
 *
 * The panel's left pane asks who the check is about and its right pane says where it searches, and
 * they are separate components because they answer separate questions. A draft is what keeps them
 * one form: both bind to the same object, and the panel composes the request off it, so there is
 * no copy of any field for a second copy to drift from.
 *
 * A DRAFT IS MADE PER OPENING, never emptied and reused. A panel reopened after a run must not
 * still be holding the last run's parties, and the surest way to know it is not is to have nothing
 * left to empty: the panel makes a new draft each time it opens and the old one is dropped. The
 * alternative — a `reset()` naming every field — is a second list of the opening values, and the
 * two lists disagree the first time a field is added to only one of them.
 *
 * THE DRAFT HOLDS NO NUMBER. It used to carry a hop budget per kind of relationship and two limits,
 * and the owner removed them on 2026-09-11: a check follows every recorded relationship to closure,
 * and the one bound on a run is the platform's, not a setting. What is left is where to search and
 * how to compare names.
 *
 * The composition, the refusal and what the check will do live in check-request.ts, over plain
 * values, so they can be reasoned about without a component.
 */
import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
import type { MessagingChannel, Strictness, TaskMatterStatus } from "./conflicts-api.ts";
import { OPENING_DRAFT, type CheckDraftValues } from "./check-request.ts";

export class CheckDraft implements CheckDraftValues {
  /** The Directory entities the check is about. Entities, never typed names. */
  parties = $state<PickableEntity[]>([]);

  searchRelationships = $state(OPENING_DRAFT.searchRelationships);
  searchOwnPeople = $state(OPENING_DRAFT.searchOwnPeople);
  nameMatching = $state<Strictness>(OPENING_DRAFT.nameMatching);
  messaging = $state<MessagingChannel[]>([...OPENING_DRAFT.messaging]);
  tasks = $state<TaskMatterStatus[]>([...OPENING_DRAFT.tasks]);
  magnus = $state(OPENING_DRAFT.magnus);

  /** The subjects as the contract wants them. Reading it tracks the picker, as a derived should. */
  get subjectEntityIds(): readonly string[] {
    return this.parties.map((party) => party.identifier);
  }
}
