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
   * THE TOOLBAR CARRIES NEITHER THE CREATE CONTROL NOR THE SEARCH NOR THE PANE TOGGLES. The New menu
   * that anchored its far end — the three ways something new lands here — moved up to the matter
   * header beside the matter's search (owner's placement, 2026-09-03), where one control serves
   * every section. The search followed it: this surface had a second field of its own, and one
   * matter is searched from one place. The two pane toggles went the other way, down to the counts
   * strip (owner's ruling, 2026-09-03), which is where every surface in the product now answers the
   * question: this toolbar is where a reader goes somewhere, not where they arrange the panes. The
   * New Folder in the rail and the folder-level context menu are gestures on a place, not a second
   * button, and stay.
   *
   * THE DISPLAY SETTINGS SIT BEFORE THE VIEW SWAPPER, not after it. The settings control belongs to
   * the icon view alone, so it comes and goes; the swapper does not. Ending the row with the one
   * that comes and goes moved the swapper sideways every time a reader changed view — the same
   * defect the create control's fixed width was fixed for. The anchor holds the end of the row.
   */
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Button from "@magna-carta/design-system/button";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import ArrowLeft from "@lucide/svelte/icons/arrow-left";
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import ArrowUp from "@lucide/svelte/icons/arrow-up";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import LayoutGrid from "@lucide/svelte/icons/layout-grid";
  import List from "@lucide/svelte/icons/list";
  import Settings2 from "@lucide/svelte/icons/settings-2";
  import { FOLDER_TREE_HOME_ICON } from "@magna-carta/design-system/folder-tree";
  import type { FileManagerState } from "./file-manager-state.svelte.ts";

  let {
    manager,
    /** Home first, then each ancestor, ending here. Empty past Home means the reader is at the root. */
    trail,
    viewTitle = null,
  }: {
    manager: FileManagerState;
    trail: readonly { id: string; label: string }[];
    /**
     * A view that is not a place in the folder tree TITLES the breadcrumb rather than adding a
     * heading beneath it — one name for where you are, in the place the name already lives.
     */
    viewTitle?: string | null;
  } = $props();

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
      <!-- The view's name carries its own ink. Text that names no colour takes the browser's, which
           is black whatever the mode is, so this crumb read black on the dark theme's dark band. -->
      <span class="px-8 text-sm font-semibold whitespace-nowrap text-text-default" aria-current="page">
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
    {#if iconView}
      <!-- The two display settings ride the table header's menu everywhere there IS a header. The
           icon view has no table at all, so it carries them here instead — not a second home for
           them, the only one this view has. -->
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
  </div>
</div>
