<script lang="ts">
  /*
   * The catalogue's "tiles" view — every entry as a card under its section's heading. Registered
   * with the multi-view shell; it reads the shell's items (the sections, already narrowed by the
   * screen's search) and ignores the shared selection, which a catalogue does not use.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { CatalogueSection } from "./catalogue.ts";
  import CatalogueTile from "./catalogue-tile.svelte";

  let { items }: { items: readonly CatalogueSection[] } = $props();
</script>

<div class="flex flex-col gap-32">
  {#each items as section (section.id)}
    <section class="flex flex-col gap-16">
      <FieldLabel as="h2" class="border-b border-border-strong pb-8">{section.label}</FieldLabel>
      <div class="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
        {#each section.entries as entry (entry.id)}
          <CatalogueTile {entry} />
        {/each}
      </div>
    </section>
  {/each}
</div>
