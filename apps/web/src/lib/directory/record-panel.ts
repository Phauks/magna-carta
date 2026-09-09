/*
 * How tall a directory record's panel stands, and why it is one height rather than its content's.
 *
 * A PANEL WITH A SIDE RAIL MUST NOT RESIZE WHEN THE RAIL IS USED. The modal frame sizes to its
 * content by design — fit first, then cap — which is right for a panel whose content is fixed: a
 * short question opens short, with no scrollbar and no band of empty space. It is wrong for a panel
 * whose content is CHOSEN from a rail beside it. Names is four fields; Relationships is a table;
 * Duplicates is a list that depends on what the firm holds. Sized to content, the panel jumped
 * taller and shorter under the pointer on every rail press, and the rail item the reader wanted next
 * had moved by the time they got there — the panel resizing is itself what makes the rail hard to
 * use.
 *
 * So the record's panels take ONE height for the screen they open on, and the chosen section scrolls
 * inside it. The reader's own gesture — pressing a rail item — never changes the geometry it was
 * aimed at.
 *
 * IT STILL DEPENDS ON THE SCREEN, which is the other half of the rule. A fixed number of rems would
 * be a panel that overflows a laptop and wastes a monitor, so the height is the smaller of a
 * comfortable measure and a share of the viewport: on a tall screen the panel stops growing where a
 * record stops being readable in one glance; on a short one it takes what the screen has, and the
 * modal stage's own cap and gutter (packages/design-system/src/lib/styles/recipes/modal-stage.css)
 * are what keep it off the edges. The header band, the notice band and the action bar sit outside
 * this, so the value is the BODY's height and not the panel's.
 *
 * It is a length rather than a class because a class cannot carry a `min()` of a rem and a viewport
 * unit, and it is shared rather than written twice because the New Person panel and the record
 * window are the same document being written and read back — a reader who enters a person and opens
 * them again must not meet two differently-shaped panels.
 */

/**
 * The block size of a record panel's body: the rail and the section beside it.
 *
 * `dvh` rather than `vh` so a mobile browser's collapsing address bar does not leave the panel
 * taller than the screen it is on.
 */
export const RECORD_PANEL_BODY_HEIGHT = "min(34rem, 62dvh)";

/** The style a panel's rail-and-section body carries. One string, so nothing re-spells the unit. */
export const RECORD_PANEL_BODY_STYLE = `block-size: ${RECORD_PANEL_BODY_HEIGHT}`;
