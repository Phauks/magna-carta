<script lang="ts">
  /*
   * A pane whose fact the firm records and cannot yet read back.
   *
   * Three of this record's panes are in that position: the relationships that make an imputed
   * conflict explicable, the matters this entity is a party to, and the categories the firm files it
   * under. All three are real, stored, matched-on facts. None of them has a read.
   *
   * The standing rule is that such a capability still RENDERS — its real anatomy, its real words,
   * the control disabled, the mark beside it, and one honest line naming what its arrival waits on.
   * A pane left out would tell a reader the firm does not keep the fact, which is false; a pane
   * showing an empty table with no explanation would tell them this entity has none, which is also
   * false. The shape of what is coming is the deliverable.
   *
   * The control is DISABLED rather than live even where the write exists, and that is deliberate:
   * recording a relationship nobody can read back is how a record accumulates four copies of the
   * same fact with nothing on screen to show it happened.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import Plus from "@lucide/svelte/icons/plus";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";

  let {
    heading,
    columns,
    actionLabel,
    waitingOn,
    caption,
  }: {
    heading: string;
    /** The columns this pane will carry, in the order it will carry them. */
    columns: readonly string[];
    /** The act this pane will offer, worded exactly as it will be worded. */
    actionLabel: string;
    /** What the pane waits on, as a noun phrase. The affordance completes the sentence. */
    waitingOn: string;
    /** The table's accessible name. */
    caption: string;
  } = $props();
</script>

<section class="flex flex-col gap-16">
  <h3 class="text-sm font-semibold">{heading}</h3>

  <DataTable.Root>
    <DataTable.Caption class="sr-only">{caption}</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        {#each columns as column (column)}
          <DataTable.Head>{column}</DataTable.Head>
        {/each}
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      <DataTable.Row>
        <DataTable.Cell colspan={columns.length}>
          <span class="text-text-muted">Kept on the record, and not yet readable here.</span>
        </DataTable.Cell>
      </DataTable.Row>
    </DataTable.Body>
  </DataTable.Root>

  <SoonAffordance reason={waitingOn} reasonPlacement="line">
    {#snippet control(soon)}
      <Button variant="secondary" {...soon}>
        <Plus class="size-16" aria-hidden="true" />
        {actionLabel}
      </Button>
    {/snippet}
  </SoonAffordance>
</section>
