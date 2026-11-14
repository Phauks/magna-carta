<script lang="ts">
  /*
   * The grouped litigation grid with an add line at each band's foot, holding which band's line is
   * open. A surface owns that state; this fixture is the smallest surface that does.
   */
  import Button from "../../lib/components/button/index.ts";
  import Input from "../../lib/components/input/index.ts";
  import type { GridBandFoot, GridGrouping } from "../../lib/components/data-table/index.ts";
  import LitigationGrid, { type TimeEntry } from "./litigation-grid.svelte";

  let { grouping }: { grouping: GridGrouping<TimeEntry> } = $props();

  let openKey = $state<string | null | undefined>(undefined);

  const bandFoot: GridBandFoot<TimeEntry> = {
    editing: (key) => openKey !== undefined && openKey === key,
    cell: footCell,
    rest: footRest,
  };
</script>

{#snippet footRest({ bandKey, label }: { bandKey: string | null; label: string | null })}
  <Button variant="ghost" size="sm" onclick={() => (openKey = bandKey)}>
    {label === null ? "Add an entry" : `Add an entry for ${label}`}
  </Button>
{/snippet}

{#snippet footCell({ column }: { column: { id: string }; bandKey: string | null })}
  {#if column.id === "title"}
    <Input size="sm" aria-label="New entry title" />
  {/if}
{/snippet}

<LitigationGrid {grouping} {bandFoot} />
