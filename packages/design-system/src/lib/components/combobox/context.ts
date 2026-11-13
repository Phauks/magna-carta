/*
 * A shared id so the Combobox.Input's `aria-controls` can name the Content listbox: bits' combobox
 * input sets role="combobox" + aria-expanded but NOT aria-controls, so we wire it ourselves. Root
 * mints the id and provides it; Input consumes it for aria-controls; Content uses it as the listbox
 * element id.
 */
export const COMBOBOX_LISTBOX_ID = Symbol("mc-combobox-listbox-id");

/*
 * The field box the listbox anchors to. Bits anchors a combobox's floating layer to the <input>
 * alone, which is the text box INSIDE the bordered field the person sees — end-aligned to that,
 * the panel would stop short of the chevron. Root provides one reactive slot; Input writes the
 * bordered box it renders into it; Content anchors to it unless a caller passes `customAnchor`.
 */
export const COMBOBOX_FIELD_ANCHOR = Symbol("mc-combobox-field-anchor");

export type ComboboxFieldAnchor = { element: HTMLElement | null };

/*
 * Opens the list from the text box itself. Bits opens a combobox from its chevron or a keystroke
 * only, so a click in the box, which is most of the control and the part a person aims at, did
 * nothing until they typed. Root owns the open state, so Root provides the one way to open it, and
 * reports the change through the caller's `onOpenChange` exactly as a chevron press would.
 */
export const COMBOBOX_OPENER = Symbol("mc-combobox-opener");

export type ComboboxOpener = { readonly isOpen: boolean; open: () => void };
