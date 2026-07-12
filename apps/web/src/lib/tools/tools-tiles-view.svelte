<script lang="ts">
  /*
   * The Tools "tiles" view — every permitted tool as a card, grouped by subject. Registered with
   * the multi-view shell; it reads the shell's items (the visible tool groups) and ignores the
   * shared selection, which tools do not use.
   */
  import type { GroupedTools } from "@magna-carta/tools/select";
  import { SUBJECT_GROUP_LABELS, toolIcon, toolPresentation } from "./tool-presentation.ts";
  import ToolTile from "./tool-tile.svelte";

  let { items }: { items: readonly GroupedTools[] } = $props();
</script>

<div class="flex flex-col gap-32">
  {#each items as { group, tools } (group)}
    <section class="flex flex-col gap-16">
      <h2
        class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {SUBJECT_GROUP_LABELS[group]}
      </h2>
      <div class="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
        {#each tools as tool (tool.id)}
          <ToolTile {tool} presentation={toolPresentation(tool)} icon={toolIcon(tool)} />
        {/each}
      </div>
    </section>
  {/each}
</div>
