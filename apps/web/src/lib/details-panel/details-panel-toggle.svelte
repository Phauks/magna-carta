<script lang="ts">
  /*
   * DetailsPanel.Toggle — the control that shows and hides the panel, and the reason the panel
   * itself has no opener.
   *
   * SELECTION IS NOT PRESENTATION: a reader selects a row to act on it, and a panel that appeared
   * because of that would take the width away from the list on every click. So showing the panel is
   * this control's job alone, the choice persists per surface, and while the panel is open it
   * follows the selection.
   *
   * IT RIDES THE COUNTS STRIP, at its inline end, after the surface's own figures (owner's ruling,
   * 2026-09-03). Not a row above the table: showing a panel is not an act on the records, so it does
   * not belong where a surface's verbs are — and the four financial ledgers, which have no toolbar
   * of their own, each drew a row to hold it whose only occupant most of the time was this glyph.
   * The strip beneath the table already holds one line and already carries trailing figures and a
   * surface's quiet controls, so the toggle joins something rather than summoning something.
   *
   * It is not free, and does not need to be: measured, the strip grows from 32 points to 41 to seat
   * the control, against the 41 the row above the table cost. That is a net 32 points back to the
   * table AND one less band between the reader and the records, which is the whole of the trade.
   * Hence `icon-sm` rather than the default icon square, which would cost four points more.
   *
   * IT IS A QUIET CHROME AFFORDANCE — no border of its own, reading its state through `aria-pressed`
   * alone, which the ghost recipe draws as the accent hairline and never as a filled box. Four
   * ledgers wrote that out identically, comment included, which is how a "quiet chrome affordance"
   * becomes four slightly different ones the first time it is corrected.
   */
  import Button from "@magna-carta/design-system/button";
  import PanelRight from "@lucide/svelte/icons/panel-right";

  let {
    open,
    onToggle,
  }: {
    /** Whether the panel is currently showing. */
    open: boolean;
    /** Called with what the panel should become. */
    onToggle: (open: boolean) => void;
  } = $props();

  /*
   * The label says which way pressing goes, rather than naming both directions at once. "Show or
   * hide" made a reader work out which one they were about to get from a glyph that already tells
   * them: the control knows its state, so it can say the next step instead of the pair.
   */
  const label = $derived(open ? "Hide the details panel" : "Show the details panel");
</script>

<Button
  variant="ghost"
  size="icon-sm"
  aria-pressed={open}
  title={label}
  aria-label={label}
  onclick={() => onToggle(!open)}
>
  <PanelRight class="size-16" aria-hidden="true" />
</Button>
