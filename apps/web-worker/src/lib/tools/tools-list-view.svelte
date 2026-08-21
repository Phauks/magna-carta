<script lang="ts">
  /*
   * The Tools "list" view — every permitted tool as a dense row, grouped by subject. Registered
   * with the multi-view shell; it reads the shell's items (the visible tool groups) and ignores the
   * shared selection, which tools do not use.
   */
  import type { GroupedTools } from "@magna-carta/tools/select";
  import { SUBJECT_GROUP_LABELS, toolIcon, toolPresentation } from "./tool-presentation.ts";
  import ToolRow from "./tool-row.svelte";

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
      <ul
        class="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default"
      >
        {#each tools as tool (tool.id)}
          <li><ToolRow {tool} presentation={toolPresentation(tool)} icon={toolIcon(tool)} /></li>
        {/each}
      </ul>
    </section>
  {/each}
</div>
