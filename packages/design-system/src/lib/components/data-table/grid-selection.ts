/*
 * Grid selection — the settled selection model of the matter surfaces (the Docket's, shared
 * exactly): click selects one (clicking the sole selection again lets it go), Ctrl/Cmd+click
 * toggles a row in and out, Shift+click extends a range from the anchor (with Ctrl, the range
 * joins the existing selection), Ctrl+A selects everything in view, arrows move the selection and
 * Shift+arrows extend it, and clicking empty space clears. Selection is STATE, not presentation —
 * the grid emits it and never opens panels.
 *
 * Pure transitions over an ordered key list; the grid state applies them and the component wires
 * the gestures.
 */

export interface GridSelection {
  /** The selected row keys. Order is not meaningful; membership is. */
  keys: readonly string[];
  /** The range anchor — where a Shift range extends from. */
  anchor: string | null;
  /** The focus row — where arrow navigation continues from. */
  focus: string | null;
}

export function emptyGridSelection(): GridSelection {
  return { keys: [], anchor: null, focus: null };
}

function rangeBetween(
  orderedKeys: readonly string[],
  fromKey: string,
  toKey: string,
): readonly string[] {
  const from = orderedKeys.indexOf(fromKey);
  const to = orderedKeys.indexOf(toKey);
  if (from === -1 || to === -1) return [toKey];
  const [low, high] = from < to ? [from, to] : [to, from];
  return orderedKeys.slice(low, high + 1);
}

export interface GridClickModifiers {
  /** Shift held — extend a range from the anchor. */
  shift?: boolean;
  /** Ctrl/Cmd held — toggle membership (or union a shift range into the selection). */
  toggle?: boolean;
  /**
   * True on the second click of a double-click (event.detail > 1): the sole-selection let-go is
   * suppressed so activation never churns select → deselect → select (the settled defect fix).
   */
  repeated?: boolean;
}

/** The selection after a pointer gesture on a row. */
export function gridSelectionAfterRowClick(
  orderedKeys: readonly string[],
  selection: GridSelection,
  key: string,
  modifiers: GridClickModifiers = {},
): GridSelection {
  if (modifiers.shift && selection.anchor !== null) {
    const range = rangeBetween(orderedKeys, selection.anchor, key);
    const keys = modifiers.toggle ? [...new Set([...selection.keys, ...range])] : [...range];
    return { keys, anchor: selection.anchor, focus: key };
  }
  if (modifiers.toggle) {
    const has = selection.keys.includes(key);
    return {
      keys: has
        ? selection.keys.filter((candidate) => candidate !== key)
        : [...selection.keys, key],
      anchor: key,
      focus: key,
    };
  }
  const wasSole = selection.keys.length === 1 && selection.keys[0] === key;
  if (wasSole && !modifiers.repeated) return emptyGridSelection();
  return { keys: [key], anchor: key, focus: key };
}

/**
 * The selection after an arrow step. In a list there is no horizontal axis, so Left/Right map to
 * the same -1/+1 steps as Up/Down — never dead keys. Plain arrows move a sole selection; Shift
 * extends the range from the anchor.
 */
export function gridSelectionAfterArrow(
  orderedKeys: readonly string[],
  selection: GridSelection,
  step: -1 | 1,
  shift: boolean,
): GridSelection {
  if (orderedKeys.length === 0) return emptyGridSelection();
  const at = orderedKeys.indexOf(selection.focus ?? selection.anchor ?? "");
  const nextIndex = at === -1 ? 0 : Math.min(orderedKeys.length - 1, Math.max(0, at + step));
  const key = orderedKeys[nextIndex]!;
  if (shift && selection.anchor !== null && orderedKeys.includes(selection.anchor)) {
    return {
      keys: [...rangeBetween(orderedKeys, selection.anchor, key)],
      anchor: selection.anchor,
      focus: key,
    };
  }
  return { keys: [key], anchor: key, focus: key };
}

/** Select everything in view (Ctrl+A, scoped to the grid — text fields keep native select-all). */
export function gridSelectionOfAll(orderedKeys: readonly string[]): GridSelection {
  return {
    keys: [...orderedKeys],
    anchor: orderedKeys[0] ?? null,
    focus: orderedKeys[0] ?? null,
  };
}

/** The selection with keys that left the view (filtered away, deleted) dropped. */
export function gridSelectionRetained(
  selection: GridSelection,
  presentKeys: ReadonlySet<string>,
): GridSelection {
  const keys = selection.keys.filter((key) => presentKeys.has(key));
  if (keys.length === selection.keys.length) return selection;
  return {
    keys,
    anchor:
      selection.anchor !== null && presentKeys.has(selection.anchor) ? selection.anchor : null,
    focus: selection.focus !== null && presentKeys.has(selection.focus) ? selection.focus : null,
  };
}
