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
   * IT IS THE FILE MANAGER'S PANE TOGGLE, TO THE GLYPH — a quiet chrome affordance with no border
   * of its own, reading its state through the glyph and never a filled box — and it sits last in
   * the row on every ledger. Four ledgers wrote that out identically, comment included, which is
   * how a "quiet chrome affordance" becomes four slightly different ones the first time it is
   * corrected.
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
</script>

<Button
  variant="ghost"
  size="icon"
  aria-pressed={open}
  title="Show or hide the details panel"
  aria-label="Show or hide the details panel"
  onclick={() => onToggle(!open)}
>
  <PanelRight class="size-16" aria-hidden="true" />
</Button>
