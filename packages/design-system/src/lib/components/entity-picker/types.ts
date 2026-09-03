/*
 * What the entity picker is handed and what it hands back.
 *
 * THE PICKER NEVER FETCHES. The directory is the firm's own record and is not a bounded set anything
 * could hand this component as an array, so the caller supplies a SEARCH — one function — and the
 * picker owns everything around it: letting the typed text settle, refusing to ask below the floor,
 * abandoning an answer a newer question has overtaken, and telling the three states apart. That split
 * is the same one the modal shell draws with its notice slot: the design system knows how a search
 * behaves and the application knows what is being searched. It is also what lets one picker serve a
 * party, a payee, a custodian's depositor and a conflicts subject, where before each of those carried
 * its own copy of the same debounce and the same three states.
 */
import type { EntityKind } from "../entity-identity/types.ts";

/** One entity the search found, as the picker offers and returns it. */
export interface PickableEntity {
  /** The entity's own handle. What the caller persists, and what `excluded` is matched against. */
  identifier: string;
  /** The name the firm knows the entity by. Decided where entities are named, never assembled here. */
  name: string;
  kind: EntityKind;
  /**
   * A second line the caller owns — which of the entity's names the search actually landed on when it
   * was not the current one, an organization's legal name where it differs. Rendered quieter than the
   * name, and left out when there is nothing to say.
   */
  aside?: string;
}

/**
 * What one search returns.
 *
 * `capped` is the fact a ranked answer has to carry: the directory returns its best matches and not
 * all of them, and a list that hides that reads as the firm's whole record. The picker says so in the
 * list and never re-sorts what it was given — the order is the server's relevance order.
 */
export interface EntityPickerAnswer {
  hits: readonly PickableEntity[];
  capped: boolean;
}

/**
 * The seam. Called with the settled, trimmed query once it clears the floor, and with a signal that is
 * aborted the moment a newer query supersedes it; an implementation that ignores the signal still
 * works, because the picker also discards an answer that arrives late. A rejection or a throw is the
 * failed state — the picker states that the search could not run rather than showing an empty
 * directory, because the two are the same picture and not the same fact.
 */
export type EntitySearch = (query: string, signal: AbortSignal) => Promise<EntityPickerAnswer>;

/**
 * Where the picker is in answering.
 *
 * - `idle`: nothing typed; the list is closed and offers nothing.
 * - `too-short`: something typed, but not enough to ask. The picker says what is missing.
 * - `searching`: a question is out.
 * - `answered`: the list holds what came back, capped or not, possibly nothing.
 * - `failed`: the search could not run. Stated, never rendered as no matches.
 */
export type EntityPickerStatus = "idle" | "too-short" | "searching" | "answered" | "failed";
