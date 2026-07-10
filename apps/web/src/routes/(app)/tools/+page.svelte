<script lang="ts">
  /*
   * Tools — the ethereal workbench's directory. Every tool the firm offers, grouped by subject,
   * shown as a card grid or a dense list. It is the multi-view shell's proving second consumer
   * (after the primitive extraction): it registers a tiles view and a list view and renders through
   * the shell, with the view-switch in the masthead and the active view below. Runs outside any
   * matter: the standing line states it. Every entry is `soon` until its own page is built.
   */
  import type { GroupedTools } from "@magna-carta/tools/select";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import { visibleToolGroups } from "$lib/tools/tool-presentation.ts";
  import { toolsViewPreference } from "$lib/tools/tools-view-preference.svelte.ts";
  import type { ToolsView } from "$lib/tools/tools-view-preference.ts";
  import ToolsTilesView from "$lib/tools/tools-tiles-view.svelte";
  import ToolsListView from "$lib/tools/tools-list-view.svelte";
  import { createViewShell } from "$lib/view-shell/view-shell.svelte.ts";
  import type { ViewDefinition } from "$lib/view-shell/view-shell-types.ts";
  import ViewSwitch from "$lib/view-shell/view-switch.svelte";
  import ViewShellBody from "$lib/view-shell/view-shell-body.svelte";

  const groups = visibleToolGroups();

  const views: ViewDefinition<GroupedTools, ToolsView>[] = [
    { id: "tiles", label: "Tile view", icon: LayoutGrid, view: ToolsTilesView },
    { id: "list", label: "List view", icon: List, view: ToolsListView },
  ];

  const shell = createViewShell({
    views,
    activeViewPreference: toolsViewPreference,
    items: () => groups,
  });
</script>

<svelte:head><title>Tools · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Tools</Masthead.Title>
    <Masthead.Meta><span>Runs outside any matter</span></Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <ViewSwitch controller={shell} label="Choose a view" />
  </Masthead.Actions>
</Masthead.Root>

<ViewShellBody controller={shell} />
