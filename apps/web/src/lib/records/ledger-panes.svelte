<script lang="ts">
  /*
   * The two panes every ledger screen is: the list, and the details beside it.
   *
   * Time, Fees, Costs and Billing were four copies of this geometry, and four copies is how two
   * ledgers end up disagreeing about how wide the panel opens or whether the divider has a grip.
   * The one-table ruling makes a behaviour gap between two of these tables a defect by definition;
   * the frame around the table is the same argument one level out, so it is one component.
   *
   * IT TAKES THE REST OF THE SCREEN AND KEEPS IT. The height comes down an unbroken chain of
   * flex-grow over min-height-0 — never a percentage, which resolves against an indefinite height
   * and quietly does nothing. That is what stops a ledger growing taller as entries arrive: the
   * table's own scroll region absorbs them, the counts footer stays on the bottom of the screen,
   * and the page never reflows because a row landed. A pane must therefore pass the height on, so
   * both of them are flex columns rather than blocks that size to what is in them.
   *
   * THE DIVIDER CARRIES NO GRIP. It is the file manager's divider: a hairline that thickens under
   * the pointer. The centred grip handle was a second affordance for a gesture the whole edge
   * already answers, and it read as a control sitting in the middle of the screen. Resizing is
   * unchanged — the edge still drags, and the separator still takes the keyboard.
   */
  import * as Resizable from "@magna-carta/design-system/resizable";
  import type { Snippet } from "svelte";

  let {
    autoSaveId,
    panelOpen = false,
    panelSize = 28,
    panelMinSize = 18,
    panelMaxSize = 44,
    list,
    panel,
  }: {
    /** Where this surface's pane layout is remembered. One id per surface, never shared. */
    autoSaveId: string;
    /** Whether the details pane is showing. Closed, the list has the whole width. */
    panelOpen?: boolean;
    /**
     * How much of the width the details pane opens to.
     *
     * A default rather than a per-surface decision: the ledgers agree on it, and the ones that do
     * not (an invoice's details are a bigger read than a time entry's) say so here rather than by
     * rebuilding the frame.
     */
    panelSize?: number;
    panelMinSize?: number;
    panelMaxSize?: number;
    /** The list itself — the table and whatever the surface summons over it. */
    list: Snippet;
    /** The details beside it. Rendered only while the pane is open. */
    panel: Snippet;
  } = $props();
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <Resizable.PaneGroup direction="horizontal" {autoSaveId} class="min-h-0 flex-1">
    <Resizable.Pane
      defaultSize={panelOpen ? 100 - panelSize : 100}
      minSize={40}
      class="flex min-h-0 flex-col"
    >
      {@render list()}
    </Resizable.Pane>
    {#if panelOpen}
      <Resizable.Handle />
      <Resizable.Pane
        defaultSize={panelSize}
        minSize={panelMinSize}
        maxSize={panelMaxSize}
        class="flex min-h-0 flex-col"
      >
        {@render panel()}
      </Resizable.Pane>
    {/if}
  </Resizable.PaneGroup>
</div>
