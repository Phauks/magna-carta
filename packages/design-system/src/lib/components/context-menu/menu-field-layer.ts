/*
 * A field inside a submenu keeps its own floating layer.
 *
 * Bits' submenu closes the moment focus lands anywhere that is not itself, its parent panel or a
 * descendant submenu, which is right for the menus it was written for: focus leaving is the reader
 * moving on. It is wrong for a submenu that hosts a FIELD, because a field may open a floating
 * layer of its own — the DatePicker's calendar, a Select's list — and that layer is portaled to the
 * body, outside the submenu's DOM. Focus moved into the calendar read as focus leaving, the submenu
 * closed, and closing unmounted the very field whose calendar had just opened: the grid's date
 * range filter vanished the instant its calendar was reached for, and no date could be set by it.
 *
 * Focus inside a floating layer that is not a menu is focus inside the field that opened it, so the
 * submenu stays. The layers named here are the ones a field opens; a nested submenu is not among
 * them because Bits already keeps its own. Attach as the submenu content's `onFocusOutside`, after
 * the caller's own handler has had its say — a handler that already prevented the default has
 * decided, and this one only decides where nothing else has.
 */

/** The floating panels a field opens, by the part attribute Bits stamps on each. */
const FIELD_LAYER_SELECTOR =
  "[data-popover-content], [data-select-content], [data-combobox-content]";

export function keepMenuFieldLayer(event: FocusEvent): void {
  if (event.defaultPrevented) return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest(FIELD_LAYER_SELECTOR) !== null) event.preventDefault();
}
