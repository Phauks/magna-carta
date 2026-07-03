/*
 * A shared id so the Combobox.Input's `aria-controls` can name the Content listbox: bits' combobox
 * input sets role="combobox" + aria-expanded but NOT aria-controls, so we wire it ourselves. Root
 * mints the id and provides it; Input consumes it for aria-controls; Content uses it as the listbox
 * element id.
 */
export const COMBOBOX_LISTBOX_ID = Symbol("mc-combobox-listbox-id");
