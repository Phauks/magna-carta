/*
 * Where a modal panel sits on the screen — the one axis of a panel's geometry that a caller may
 * choose, named here so the shells, the stage recipe and a reader of the DOM all use the same word.
 *
 *   centered  The panel is a flex item of the modal stage (styles/recipes/modal-stage.css): centred
 *             in the screen less its gutter, capped there when it does not fit. Every dialog, alert
 *             dialog, action dialog and record window; the default, and the only one most panels
 *             ever need.
 *   anchored  The panel leaves the stage's layout and positions itself against the viewport with
 *             insets it supplies. The command palette, which opens on its search trigger rather
 *             than in the middle of the screen, is the one user.
 *
 * A new placement is a new member here, a rule on `.mc-modal-panel[data-modal-placement=...]` in
 * the stage recipe, and a row in modal-geometry/matrix.ts so the sweep measures it — nothing else.
 */
export type ModalPlacement = "centered" | "anchored";

export const DEFAULT_MODAL_PLACEMENT: ModalPlacement = "centered";

/** The attribute a panel carries so its placement can be read off the DOM and matched by CSS. */
export const MODAL_PLACEMENT_ATTRIBUTE = "data-modal-placement";
