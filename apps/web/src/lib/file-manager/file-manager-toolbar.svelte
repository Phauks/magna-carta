<script lang="ts">
  /*
   * The file manager's toolbar: where the reader stands, how they got here, and how the panes are
   * arranged. Back, forward and up are all three here — a file manager without them is one somebody
   * has to leave and re-enter to get out of.
   *
   * The breadcrumb's root is the HOME ICON, the same Lucide house the rail's root row draws, so the
   * two names for one place cannot drift into two glyphs. Its hover box is the toolbar button's box
   * exactly: same size, same radius, same surface, because a control that changes shape between
   * neighbours reads as a different kind of control.
   *
   * The hovers say what the control does and the key that does the same thing — "Back", "Forward",
   * "Up" — and nothing else. A tooltip that explains a back button is a tooltip nobody reads twice.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Button from "@magna-carta/design-system/button";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import { FOLDER_TREE_HOME_ICON } from "@magna-carta/design-system/folder-tree";
  import type { DataTableGridState } from "@magna-carta/design-system/data-table";
  import type { FileManagerRow } from "./file-rows.ts";
  import type { FileManagerState } from "./file-manager-state.svelte.ts";

  let {
    manager,
    grid,
    /** Home first, then each ancestor, ending here. Empty past Home means the reader is at the root. */
    trail,
    viewTitle = null,
  }: {
    manager: FileManagerState;
    grid: DataTableGridState<FileManagerRow>;
    trail: readonly { id: string; label: string }[];
    /**
     * A view that is not a place in the folder tree TITLES the breadcrumb rather than adding a
     * heading beneath it — one name for where you are, in the place the name already lives.
     */
    viewTitle?: string | null;
  } = $props();

  const HomeIcon = FOLDER_TREE_HOME_ICON;
</script>

<div class="flex items-center gap-4 border-b border-border-default px-8 py-4">
  <Button
    variant="ghost"
    size="icon"
    disabled={!manager.canGoBack}
    title="Back (Alt+Left)"
    aria-label="Back"
    onclick={() => manager.goBack()}
  >
    <ArrowLeft class="size-16" aria-hidden="true" />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    disabled={!manager.canGoForward}
    title="Forward (Alt+Right)"
    aria-label="Forward"
    onclick={() => manager.goForward()}
  >
    <ArrowRight class="size-16" aria-hidden="true" />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    disabled={!manager.canGoUp}
    title="Up (Alt+Up)"
    aria-label="Up"
    onclick={() => manager.goUp(trail.at(-2)?.id === undefined ? null : (trail.at(-2)?.id ?? null))}
  >
    <ArrowUp class="size-16" aria-hidden="true" />
  </Button>

  <nav class="mc-scrollbar flex min-w-0 items-center gap-4 overflow-x-auto" aria-label="Folder path">
    <Button
      variant="ghost"
      size="icon"
      title="Home"
      aria-label="Home"
      aria-current={viewTitle === null && trail.length === 0 ? "page" : undefined}
      onclick={() => manager.openFolder(null)}
    >
      <HomeIcon class="size-16" aria-hidden="true" />
    </Button>
    {#if viewTitle !== null}
      <ChevronRight class="size-12 shrink-0 text-text-subtle" aria-hidden="true" />
      <span class="px-8 text-sm font-semibold whitespace-nowrap" aria-current="page">
        {viewTitle}
      </span>
    {:else}
      {#each trail as crumb, index (crumb.id)}
        <ChevronRight class="size-12 shrink-0 text-text-subtle" aria-hidden="true" />
        <Button
          variant="ghost"
          size="sm"
          class="whitespace-nowrap"
          aria-current={index === trail.length - 1 ? "page" : undefined}
          onclick={() => manager.openFolder(crumb.id)}
        >
          {crumb.label}
        </Button>
      {/each}
    {/if}
  </nav>

  <div class="ms-auto flex items-center gap-4">
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={manager.listMode === "icons"}
      title={manager.listMode === "icons" ? "Show as a list" : "Show as icons"}
      aria-label={manager.listMode === "icons" ? "Show as a list" : "Show as icons"}
      onclick={() => manager.setListMode(manager.listMode === "icons" ? "list" : "icons")}
    >
      {#if manager.listMode === "icons"}
        <List class="size-16" aria-hidden="true" />
      {:else}
        <LayoutGrid class="size-16" aria-hidden="true" />
      {/if}
    </Button>
    <DataTable.GridColumnsMenu {grid} />
    <!-- An active pane toggle carries no dark fill. The complaint was always the fill. -->
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={manager.railOpen}
      title="Show or hide the folder tree"
      aria-label="Show or hide the folder tree"
      onclick={() => manager.setRailOpen(!manager.railOpen)}
    >
      <PanelLeft class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={manager.panelOpen}
      title="Show or hide the details panel"
      aria-label="Show or hide the details panel"
      onclick={() => manager.setPanelOpen(!manager.panelOpen)}
    >
      <PanelRight class="size-16" aria-hidden="true" />
    </Button>
  </div>
</div>
