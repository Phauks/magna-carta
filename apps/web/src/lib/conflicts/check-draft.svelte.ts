/*
 * The New Check panel's draft — one object, two panes.
 *
 * The panel's left pane asks who the check is about and its right pane sets how widely the engine
 * searches, and they are separate components because they answer separate questions. A draft is
 * what keeps them one form: both bind to the same object, and the panel composes the request off
 * it, so there is no copy of any field for a second copy to drift from.
 *
 * A DRAFT IS MADE PER OPENING, never emptied and reused. A panel reopened after a run must not
 * still be holding the last run's parties, and the surest way to know it is not is to have nothing
 * left to empty: the panel makes a new draft each time it opens and the old one is dropped. The
 * alternative — a `reset()` naming every field — is a second list of the opening values, and the
 * two lists disagree the first time a field is added to only one of them.
 *
 * The composition, the refusal and what the check will do live in check-request.ts, over plain
 * values, so they can be reasoned about without a component.
 */
import type { PickableEntity } from "@magna-carta/design-system/entity-picker";
import type { BudgetedEdgeClass, Strictness } from "./conflicts-api.ts";
import type { MatterSummary } from "$lib/matters/matters-api.ts";
import { OPENING_DRAFT, type CheckDraftValues } from "./check-request.ts";

export class CheckDraft implements CheckDraftValues {
  /** The Directory entities the check is about. Entities, never typed names. */
  parties = $state<PickableEntity[]>([]);

  /**
   * The matter chosen in the panel, where the panel asks for one. Null when it asks nothing —
   * either because nothing is chosen yet, or because the surface already knows the matter.
   */
  chosenMatter = $state<MatterSummary | null>(null);

  searchRelationships = $state(OPENING_DRAFT.searchRelationships);
  searchOwnPeople = $state(OPENING_DRAFT.searchOwnPeople);
  nameMatching = $state<Strictness>(OPENING_DRAFT.nameMatching);
  relationshipHops = $state<Record<BudgetedEdgeClass, string>>({
    ...OPENING_DRAFT.relationshipHops,
  });
  relatedPartyLimit = $state(OPENING_DRAFT.relatedPartyLimit);
  candidateLimit = $state(OPENING_DRAFT.candidateLimit);

  /** The subjects as the contract wants them. Reading it tracks the picker, as a derived should. */
  get subjectEntityIds(): readonly string[] {
    return this.parties.map((party) => party.identifier);
  }

  /** One hop budget, set from its field. Assigning through a getter keeps the record's identity. */
  setHops(edgeClass: BudgetedEdgeClass, text: string): void {
    this.relationshipHops = { ...this.relationshipHops, [edgeClass]: text };
  }
}
