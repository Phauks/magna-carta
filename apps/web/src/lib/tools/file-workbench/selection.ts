/*
 * Which files are selected, and which one the panels are describing.
 *
 * Two different things, and keeping them apart is what makes bulk work: the ACTIVE file is the one
 * in focus, whose readings fill the panel; the SELECTION is every file a bulk capability would act
 * on. Converting six files at once is the reason the selection exists, and a surface that can only
 * hold one would make a person repeat themselves six times.
 *
 * The gestures are the ones every file list has: click selects one, shift-click extends a range
 * from the anchor, and ctrl/cmd-click adds or removes one without disturbing the rest. There are no
 * checkbox squares beside the rows; a row selects by being clicked, and the count and the clear
 * action live in the footer. That is the matter file manager's settled behaviour, and this surface
 * is the same body with a different source.
 *
 * Pure and DOM-free, so the behaviour is testable without rendering anything.
 */

export interface SelectionState {
  readonly selected: ReadonlySet<string>;
  /** Where a shift-range extends from. Set by every gesture that is not itself a range. */
  readonly anchorId: string | null;
  /** The file the panels describe. Always a member of `selected` when anything is selected. */
  readonly activeId: string | null;
}

export const EMPTY_SELECTION: SelectionState = {
  selected: new Set(),
  anchorId: null,
  activeId: null,
};

export interface SelectionGesture {
  readonly id: string;
  /** Shift was held: extend from the anchor to here. */
  readonly range: boolean;
  /** Ctrl or Cmd was held: add or remove this one, leave the rest alone. */
  readonly toggle: boolean;
}

function rangeBetween(orderedIds: readonly string[], from: string, to: string): string[] {
  const start = orderedIds.indexOf(from);
  const end = orderedIds.indexOf(to);
  if (start === -1 || end === -1) return [to];
  const [low, high] = start <= end ? [start, end] : [end, start];
  return orderedIds.slice(low, high + 1);
}

/** The selection after one gesture on a list in `orderedIds` order. */
export function applySelection(
  state: SelectionState,
  gesture: SelectionGesture,
  orderedIds: readonly string[],
): SelectionState {
  if (gesture.range && state.anchorId !== null) {
    // A range replaces the selection and leaves the anchor where it was, so dragging the far end
    // back and forth keeps extending from the same place rather than walking the anchor along.
    return {
      selected: new Set(rangeBetween(orderedIds, state.anchorId, gesture.id)),
      anchorId: state.anchorId,
      activeId: gesture.id,
    };
  }

  if (gesture.toggle) {
    const next = new Set(state.selected);
    if (next.has(gesture.id)) next.delete(gesture.id);
    else next.add(gesture.id);
    // Deselecting the file in focus hands focus to another selected one rather than leaving the
    // panels describing a file that is no longer selected.
    const activeId = next.has(gesture.id)
      ? gesture.id
      : (orderedIds.find((id) => next.has(id)) ?? null);
    return { selected: next, anchorId: gesture.id, activeId };
  }

  return { selected: new Set([gesture.id]), anchorId: gesture.id, activeId: gesture.id };
}

/** Every file, selected. The footer's count doubles as the select-all control. */
export function selectAll(orderedIds: readonly string[]): SelectionState {
  const first = orderedIds[0] ?? null;
  return { selected: new Set(orderedIds), anchorId: first, activeId: first };
}

/**
 * The selection after files have gone (discarded, or reaped). Ids that no longer exist are dropped
 * rather than left behind, so a bulk action can never name a file that is not on the workbench.
 */
export function reconcile(state: SelectionState, orderedIds: readonly string[]): SelectionState {
  const present = new Set(orderedIds);
  const selected = new Set([...state.selected].filter((id) => present.has(id)));
  const activeId =
    state.activeId !== null && present.has(state.activeId)
      ? state.activeId
      : (orderedIds.find((id) => selected.has(id)) ?? orderedIds[0] ?? null);
  // An active file that survived but was not selected is selected again: the panels describe it,
  // so a bulk action offered beside those panels must include it.
  if (activeId !== null && !selected.has(activeId)) selected.add(activeId);
  return {
    selected,
    anchorId: state.anchorId !== null && present.has(state.anchorId) ? state.anchorId : activeId,
    activeId,
  };
}
