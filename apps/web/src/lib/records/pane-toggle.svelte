<script lang="ts">
  /*
   * The one control that shows and hides a side pane, wherever a surface has one.
   *
   * IT RIDES THE COUNTS STRIP. Not a row above the table (owner's ruling, 2026-09-03). Showing a
   * details panel is not an act on the records, so it does not belong where a surface's verbs are;
   * and the four financial ledgers, which have no toolbar of their own, each drew a row to hold it
   * whose only occupant most of the time was this glyph. The strip beneath the table already holds
   * one line and already carries the surface's trailing figures and its own quiet controls, so the
   * toggle joins something rather than summoning something — and every surface in the product then
   * answers the same question in the same place. It is not free: measured, the strip grows from 32
   * to 41 points to seat the control, against the 41 the row above the table cost. That is a net 32
   * points back to the table AND one less band on the screen, which is the whole of the trade. The
   * size is the strip's own: `icon-sm`, where the default icon square would cost four points more.
   *
   * IT READS ITS STATE THROUGH THE GLYPH. `aria-pressed` alone, which the ghost recipe draws as the
   * accent hairline — never a filled box, and never a second word beside it.
   *
   * ONE COMPONENT, BECAUSE FOUR COPIES DISAGREED. Time, Fees, Costs and Billing each drew their own
   * and the owner walked all four together and found four different buttons. What a reader is
   * looking at when they look at this control is one decision, so it is one file.
   */
  import Button from "@magna-carta/design-system/button";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import PanelRight from "@lucide/svelte/icons/panel-right";

  let {
    open,
    onToggle,
    /** Which pane this opens — the glyph points at the edge the pane arrives from. */
    side = "end",
    /**
     * What the pane is, as a noun phrase: "the details panel", "the folder tree". The tooltip and
     * the accessible name are built from it, so a surface never phrases either of them itself.
     */
    pane,
  }: {
    open: boolean;
    onToggle: () => void;
    side?: "start" | "end";
    pane: string;
  } = $props();

  const label = $derived(`${open ? "Hide" : "Show"} ${pane}`);
  const Glyph = $derived(side === "start" ? PanelLeft : PanelRight);
</script>

<Button
  variant="ghost"
  size="icon-sm"
  aria-pressed={open}
  title={label}
  aria-label={label}
  onclick={onToggle}
>
  <Glyph class="size-16" aria-hidden="true" />
</Button>
