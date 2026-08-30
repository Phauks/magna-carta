/*
 * The keyboard half of the menu, which is the half that used to be missing.
 *
 * A menu once drew "Ctrl C", "Ctrl X" and "Ctrl V" down the right-hand edge of its clipboard rows
 * while nothing anywhere listened for those keys. Everything about it looked right: the rows were
 * there, the keycaps were there, the verbs worked when clicked. Only the keyboard did nothing, and
 * a reader who tried it once learned not to trust the rest of the hints either.
 *
 * So a displayed shortcut resolves to the SAME action object the row renders. Not an equivalent
 * handler written beside it, not a switch on key names that has to be kept in step — the same
 * object, found by matching the chord the row is displaying. A row cannot then advertise a chord
 * that reaches somewhere else, and a chord cannot reach a verb the menu is currently refusing.
 *
 * TWO THINGS THE HANDLER DELIBERATELY DOES NOT DO:
 *
 *   It does not take a key from a field. A person typing in a rename box or a filter field means
 *   the field, and every one of these chords has a native meaning there.
 *
 *   It does not take Copy from a real text selection. Someone who has selected a sentence and
 *   pressed the copy chord wants the sentence. Copying the rows instead is the surprising answer,
 *   and it is not recoverable — the sentence is gone from the clipboard.
 */
import {
  isEnabled,
  menuItems,
  shortcutMatches,
  type RecordMenuAction,
  type RecordMenuModel,
} from "./record-menu-model.ts";

/**
 * What the surface knows about the keystroke's surroundings.
 *
 * Described as facts rather than read from the document here, so the decision is pure and the one
 * place that touches the DOM is the component.
 */
export interface KeystrokeSurroundings {
  /** Whether focus is in something that takes typing: a field, a text area, an editable region. */
  readonly inTextField: boolean;
  /** Whether the reader has actually selected some text on the page. */
  readonly hasTextSelection: boolean;
}

/** The keystroke fields the resolution needs. */
export interface Keystroke {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

/** The identifier of the one verb that yields to a real text selection. */
const COPY_IDENTIFIER = "copy";

/**
 * The action a keystroke fires, or null.
 *
 * Null covers every reason nothing should happen — focus is in a field, the chord belongs to a
 * text selection, no row displays it, or the row that does is refused for this selection. A
 * disabled row must not be reachable by its own keycaps; that would be the same defect the other
 * way round.
 */
export function shortcutAction(
  menu: RecordMenuModel,
  keystroke: Keystroke,
  surroundings: KeystrokeSurroundings,
  platform?: string,
): RecordMenuAction | null {
  if (surroundings.inTextField) return null;

  for (const item of menuItems(menu)) {
    if (item.kind !== "action") continue;
    if (item.shortcut === undefined) continue;
    if (!shortcutMatches(item.shortcut, keystroke, platform)) continue;
    if (item.identifier === COPY_IDENTIFIER && surroundings.hasTextSelection) return null;
    return isEnabled(item) ? item : null;
  }
  return null;
}

/** The element names that take typing, for the surroundings the component reads off the event. */
const TYPING_ELEMENTS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether the thing a keystroke landed on takes typing. Named separately from the resolution above
 * so the judgement can be asserted on its own, and so the component holds no logic of its own.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (target === null || !(target instanceof HTMLElement)) return false;
  if (TYPING_ELEMENTS.has(target.tagName)) return true;
  return target.isContentEditable;
}
