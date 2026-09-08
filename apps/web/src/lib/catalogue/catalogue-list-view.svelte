<script lang="ts">
  /*
   * The catalogue's "list" view — every entry as a dense row under its section's heading.
   * Registered with the multi-view shell; it reads the shell's items (the sections, already
   * narrowed by the screen's search) and ignores the shared selection, which a catalogue does not
   * use: an entry is opened, never picked.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { CatalogueSection } from "./catalogue.ts";
  import CatalogueRow from "./catalogue-row.svelte";

  let { items }: { items: readonly CatalogueSection[] } = $props();
</script>

<div class="flex flex-col gap-32">
  {#each items as section (section.id)}
    <section class="flex flex-col gap-16">
      <FieldLabel as="h2" class="border-b border-border-strong pb-8">{section.label}</FieldLabel>
      <ul
        class="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default"
      >
        {#each section.entries as entry (entry.id)}
          <li><CatalogueRow {entry} /></li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
