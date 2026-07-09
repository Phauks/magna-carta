<script lang="ts">
  /*
   * Tools — the ethereal workbench's directory. Every tool the firm offers, grouped by subject,
   * shown as a card grid or a dense list (the toggle in the masthead, a persisted per-member
   * choice). Runs outside any matter: the standing line states it. Every entry is `soon` until
   * its own page is built — nothing here is faked.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Button from "@magna-carta/design-system/button";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import {
    SUBJECT_GROUP_LABELS,
    toolIcon,
    toolPresentation,
    visibleToolGroups,
  } from "$lib/tools/tool-presentation.ts";
  import { setToolsView, toolsView } from "$lib/tools/tools-view-preference.svelte.ts";
  import ToolTile from "$lib/tools/tool-tile.svelte";
  import ToolRow from "$lib/tools/tool-row.svelte";

  const groups = visibleToolGroups();
  const view = $derived(toolsView());
</script>

<svelte:head><title>Tools · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Tools</Masthead.Title>
    <Masthead.Meta><span>Runs outside any matter</span></Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <div class="flex items-center gap-4" role="group" aria-label="Choose a view">
      <Button
        variant={view === "tiles" ? "secondary" : "ghost"}
        size="icon"
        aria-label="Tile view"
        aria-pressed={view === "tiles"}
        onclick={() => setToolsView("tiles")}
      >
        <LayoutGrid class="size-16" aria-hidden="true" />
      </Button>
      <Button
        variant={view === "list" ? "secondary" : "ghost"}
        size="icon"
        aria-label="List view"
        aria-pressed={view === "list"}
        onclick={() => setToolsView("list")}
      >
        <List class="size-16" aria-hidden="true" />
      </Button>
    </div>
  </Masthead.Actions>
</Masthead.Root>

<div class="flex flex-col gap-32">
  {#each groups as { group, tools } (group)}
    <section class="flex flex-col gap-16">
      <h2
        class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        {SUBJECT_GROUP_LABELS[group]}
      </h2>
      {#if view === "tiles"}
        <div class="grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
          {#each tools as tool (tool.id)}
            <ToolTile {tool} presentation={toolPresentation(tool)} icon={toolIcon(tool)} />
          {/each}
        </div>
      {:else}
        <ul
          class="divide-y divide-border-default overflow-hidden rounded-lg border border-border-default"
        >
          {#each tools as tool (tool.id)}
            <li><ToolRow {tool} presentation={toolPresentation(tool)} icon={toolIcon(tool)} /></li>
          {/each}
        </ul>
      {/if}
    </section>
  {/each}
</div>
