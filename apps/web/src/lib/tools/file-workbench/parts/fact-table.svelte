<script lang="ts">
  /*
   * A panel's findings, in a table with its own heading and its own edges.
   *
   * Readings used to sit as a bare label-and-value list, which left every panel looking like text
   * poured onto the page: nothing said where one set of findings ended and the next began, and a
   * long value ran into the heading under it. A table has edges, and the edges are the point — the
   * heading belongs to the rows beneath it, and the block is a thing rather than a region.
   *
   * The design system's table primitives, so a findings table is drawn by the same recipe as the
   * matter's ledgers.
   */
  import type { Snippet } from "svelte";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import type { BadgeVariant } from "@magna-carta/design-system/badge";

  export interface Fact {
    readonly label: string;
    readonly value?: string;
    readonly tone?: BadgeVariant;
    /** Renders in place of `value` where the row needs a badge or a control. */
    readonly render?: Snippet;
    /** Renders under the value at the standard meta offset. */
    readonly note?: string;
    /** Digests, media types, byte sequences: the reading that only works in the mono face. */
    readonly mono?: boolean;
  }

  let { title, facts }: { title: string; facts: readonly Fact[] } = $props();

  // Only the tones that carry a reading get a colour. Everything else is body text: a value tinted
  // for no reason competes with the ones that mean something.
  const TONE_CLASS: Partial<Record<BadgeVariant, string>> = {
    warning: "text-status-warning-subtle-foreground",
    danger: "text-status-danger-subtle-foreground",
    success: "text-status-success-subtle-foreground",
    info: "text-status-info-subtle-foreground",
  };
</script>

<DataTable.Root class="w-full">
  <DataTable.Header>
    <DataTable.Row>
      <DataTable.Head colspan={2} style="letter-spacing: var(--mc-tracking-caps)">
        {title}
      </DataTable.Head>
    </DataTable.Row>
  </DataTable.Header>
  <DataTable.Body>
    {#each facts as fact (fact.label)}
      <DataTable.Row>
        <DataTable.Cell class="w-96 align-top text-text-subtle">{fact.label}</DataTable.Cell>
        <DataTable.Cell class="align-top break-words">
          {#if fact.render}
            {@render fact.render()}
          {:else}
            <span
              class={fact.tone === undefined ? undefined : TONE_CLASS[fact.tone]}
              class:font-mono={fact.mono}
              class:tabular-nums={fact.mono}
            >
              {fact.value}
            </span>
          {/if}
          {#if fact.note}
            <span class="mt-4 block text-xs text-text-muted">{fact.note}</span>
          {/if}
        </DataTable.Cell>
      </DataTable.Row>
    {/each}
  </DataTable.Body>
</DataTable.Root>
