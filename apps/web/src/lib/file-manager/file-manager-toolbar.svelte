<script lang="ts">
  /*
   * The file manager's toolbar: where the reader stands, how they got here, and how the panes are
   * arranged. Back, forward and up are all three here — a file manager without them is one somebody
   * has to leave and re-enter to get out of. It sits at the top of the LIST column, not across the
   * whole surface: the path describes the list, so it starts where the list starts, directly above
   * the files rather than above the folder tree.
   *
   * The breadcrumb's root is the HOME ICON, the same Lucide house the rail's root row draws, so the
   * two names for one place cannot drift into two glyphs.
   *
   * THE TOOLBAR CARRIES NO CREATE CONTROL. The New menu that anchored its far end — the three ways
   * something new lands here — moved up to the matter header beside the matter's search (owner's
   * placement, 2026-09-03), where one control serves every section. The pane toggles end the row
   * now; the New Folder in the rail and the folder-level context menu are gestures on a place,
   * not a second button, and stay.
   */
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import PanelLeft from "@lucide/svelte/icons/panel-left";
  import PanelRight from "@lucide/svelte/icons/panel-right";
  import Search from "@lucide/svelte/icons/search";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import { FOLDER_TREE_HOME_ICON } from "@magna-carta/design-system/folder-tree";
  import type { FileManagerState } from "./file-manager-state.svelte.ts";

  let {
    manager,
    /** Home first, then each ancestor, ending here. Empty past Home means the reader is at the root. */
    trail,
    viewTitle = null,
    onToggleRail,
    onTogglePanel,
    onSearch,
  }: {
    manager: FileManagerState;
    trail: readonly { id: string; label: string }[];
    /**
     * A view that is not a place in the folder tree TITLES the breadcrumb rather than adding a
     * heading beneath it — one name for where you are, in the place the name already lives.
     */
    viewTitle?: string | null;
    onToggleRail: () => void;
    onTogglePanel: () => void;
    /** What the reader typed. Searching opens the results view; emptying it goes back. */
    onSearch: (query: string) => void;
  } = $props();

  let searchOpen = $state(false);

  const HomeIcon = FOLDER_TREE_HOME_ICON;


  /** The icon view is the one place with no table header to carry the display settings. */
  const iconView = $derived(manager.listMode === "icons" && manager.view === "browse");

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
    <!--
      SEARCH LIVES AT THE TOP, with the surface's other controls, not in a strip over the table.
      As a strip it sat between the breadcrumb and the column headers, so the table's own titles
      started in a different place in that view than in every other one. Here it opens as an
      overlay across the breadcrumb's slack: nothing on the row moves when it opens, and searching
      is reachable from any view rather than only from the one named after it.
    -->
    <span class="relative inline-flex">
      <Button
        variant="ghost"
        size="icon"
        aria-pressed={manager.searchQuery !== ""}
        aria-expanded={searchOpen}
        title="Search this matter's files"
        aria-label="Search"
        onclick={() => (searchOpen = true)}
      >
        <Search class="size-16" aria-hidden="true" />
      </Button>
      {#if searchOpen}
        <div class="absolute end-0 top-0 z-dropdown" style="inline-size: var(--mc-size-record-context)">
          <Input
            class="w-full"
            value={manager.searchQuery}
            placeholder={placeholderOf("Search")}
            aria-label="Search this matter's files"
            oninput={(event) => onSearch(event.currentTarget.value)}
            onblur={() => {
              if (manager.searchQuery === "") searchOpen = false;
            }}
            {@attach (field: HTMLInputElement) => field.focus()}
          />
        </div>
      {/if}
    </span>
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
    {#if iconView}
      <!-- The two display settings ride the table header's Columns menu everywhere there IS a
           header. The icon view has no table at all, so it carries them here instead — not a
           second home for them, the only one this view has. -->
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          class={buttonClasses({ variant: "ghost", size: "icon" })}
          title="Display settings"
          aria-label="Display settings"
        >
          <Settings2 class="size-16" aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="end" style="min-inline-size: var(--mc-size-popover)">
          <DropdownMenu.CheckboxItem
            bind:checked={() => manager.hideExtensions, (next) => manager.setHideExtensions(next)}
          >
            Hide file extensions
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.CheckboxItem
            bind:checked={
              () => manager.showSidebarCounts, (next) => manager.setShowSidebarCounts(next)
            }
          >
            Show file counts in the sidebar
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Root>
    {/if}
    <!-- An active pane toggle reads through its glyph and hairline, never a dark fill. -->
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={manager.railOpen}
      title="Show or hide the folder tree"
      aria-label="Show or hide the folder tree"
      onclick={onToggleRail}
    >
      <PanelLeft class="size-16" aria-hidden="true" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      aria-pressed={manager.panelOpen}
      title="Show or hide the details panel"
      aria-label="Show or hide the details panel"
      onclick={onTogglePanel}
    >
      <PanelRight class="size-16" aria-hidden="true" />
    </Button>
  </div>
</div>
