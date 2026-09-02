/*
 * A text field inside a menu has to keep its own keys.
 *
 * Bits' menu content runs typeahead and roving focus off ANY character or arrow key that reaches
 * it, and it does not exempt form controls: a "m" typed into a field inside the menu jumps focus to
 * the first item whose label starts with "m", and an arrow in a number field leaves the field
 * entirely. Every menu that hosts a field — the grid's per-column filter, the file manager's
 * document-type flyout — needs the same guard, so it is written once here rather than twice.
 *
 * Escape and Tab still travel: dismissal and focus order belong to the menu, not to the field.
 * Attach it to the field's WRAPPER in the bubble phase (`onkeydown`, never `onkeydowncapture` —
 * capturing would stop the event before the input itself ever sees it).
 */
export function keepMenuFieldKeys(event: KeyboardEvent): void {
  if (event.key === "Escape" || event.key === "Tab") return;
  event.stopPropagation();
}
