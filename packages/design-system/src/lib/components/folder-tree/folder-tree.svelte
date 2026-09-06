<script lang="ts">
  /*
   * FolderTree — the file manager's left rail, and an extension of Tree rather than a second tree.
   * Everything about moving between rows, the roving tabindex, expansion and selection is Tree's;
   * what this adds is the rail: a root row that is also the heading, the two controls beside it, a
   * right-click that reaches the folders, colour and mark, dragging a folder somewhere else, the
   * per-folder counts, and the group of views that are not places in the folders.
   *
   * THE HEADING IS THE ROOT ROW. There is no separate label above the tree: the first row is Home,
   * it is selectable, and reaching it is how a reader gets back to the root. The rail's two
   * controls — the one that opens and closes everything, and the one that makes a folder — sit at
   * that row's end, which is where a reader looks for controls that act on the whole tree.
   *
   * ONE CONTROL OPENS AND CLOSES, not two. It says what pressing it will do, so the wrong one is
   * never on screen. It deliberately leaves the root row open: collapsing the heading would hide
   * the rail's whole contents, and the control is about the folders beneath it.
   *
   * COLOUR AND MARK ARE TWO FLYOUTS, side by side in the menu, because they are two choices. The
   * palette is one row in spectrum order; a swatch is a true square with no corner radius, keeps
   * its own colour under the pointer (the outline is what says it is under the pointer), and shows
   * the chosen one with a check INSIDE the square, in whichever ink reads against that fill — an
   * indicator that never leaves the box cannot overlap its neighbours.
   *
   * A FOLDER MOVES BY BEING DRAGGED, and never into itself or anything inside it; the rail reports
   * the move and the surface that owns the undo stack records it. What is refused is refused before
   * the drop, by the pointer never being told a drop is allowed there.
   *
   * WHAT THIS DOES NOT OWN: the rail's width. Both of the screen's side panels resize the same way,
   * from one component, so the screen puts this inside a Resizable pane rather than each panel
   * growing its own grip.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import Check from "@lucide/svelte/icons/check";
  import ChevronsDownUp from "@lucide/svelte/icons/chevrons-down-up";
  import ChevronsUpDown from "@lucide/svelte/icons/chevrons-up-down";
  import FolderPlus from "@lucide/svelte/icons/folder-plus";
  import * as ContextMenu from "../context-menu/index.ts";
  import Separator from "../separator/index.ts";
  import Skeleton from "../skeleton/index.ts";
  import FolderGlyph from "../folder-glyph/index.ts";
  import Tree from "../tree/index.ts";
  import type { TreeItemContext, TreeNode } from "../tree/types.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import { FOLDER_COLORS } from "./colors.ts";
  import { FOLDER_ICONS, FOLDER_TREE_HOME_ICON, folderGlyph } from "./palette.ts";
  import { canMoveFolder } from "./move.ts";
  import type {
    FolderColorName,
    FolderIconName,
    FolderTreeMenuTarget,
    FolderTreeMove,
    FolderTreeNode,
    FolderTreeView,
  } from "./types.ts";

  /**
   * The root row's identity inside the tree. It is this component's own, never a folder's: the
   * caller says `null` for the root and never has to learn a sentinel.
   */
  const HOME_IDENTIFIER = "mc-folder-tree-home";

  let {
    folders,
    selectedFolderId = $bindable(null),
    expandedFolderIds = $bindable([]),
    views = [],
    currentViewId = undefined,
    showFileCounts = true,
    loading = false,
    label = "Folders",
    homeLabel = "Home",
    emptyMessage = "No folders yet.",
    newFolderDisabledReason = undefined,
    onNewFolder,
    onSelectFolder,
    onSelectView,
    onMoveFolder,
    onChangeColor,
    onChangeIcon,
    menuItems,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>, HTMLDivElement> & {
    /** The matter's folders, nested, in the order they render. */
    folders: FolderTreeNode[];
    /** The folder being shown, or `null` for the root. Bindable. */
    selectedFolderId?: string | null;
    /** The ids of the open folders. Bindable, so the surface remembers them across visits. */
    expandedFolderIds?: string[];
    /** The views that are not places in the folders. They render beneath a rule, with no heading. */
    views?: FolderTreeView[];
    /** The view currently open, if one is — no folder reads as selected while one is. */
    currentViewId?: string | undefined;
    /** Whether the folder rows state how many files they hold. */
    showFileCounts?: boolean;
    /** Renders the rail's shape while the folders are still being fetched. */
    loading?: boolean;
    /** Accessible name for the tree. */
    label?: string;
    /** The root row's name. */
    homeLabel?: string;
    /** What the rail says when the matter has no folders at all. */
    emptyMessage?: string;
    /**
     * Why a folder cannot be made here, when it cannot. The control still renders, disabled and
     * saying so — a view with no current folder is not a place a folder can be made, and removing
     * the control instead would move the one beside it every time the reader changed view.
     */
    newFolderDisabledReason?: string | undefined;
    /** Called when the reader asks for a new folder. */
    onNewFolder?: () => void;
    /** Called with the folder that was selected, or `null` for the root. */
    onSelectFolder?: (folderId: string | null) => void;
    /** Called with the view that was opened. */
    onSelectView?: (viewId: string) => void;
    /** Called when a folder is dragged somewhere it can go. Undoing it belongs to the surface. */
    onMoveFolder?: (move: FolderTreeMove) => void;
    /** Called when a folder is given a colour. */
    onChangeColor?: (change: { folderId: string; color: FolderColorName }) => void;
    /** Called when a folder is given a mark. */
    onChangeIcon?: (change: { folderId: string; icon: FolderIconName }) => void;
    /** The caller's own right-click items, above the colour and mark flyouts. */
    menuItems?: Snippet<[FolderTreeMenuTarget]>;
  } = $props();

  // --- the data, indexed once ---------------------------------------------------------------

  const foldersById = $derived.by(() => {
    const index = new Map<string, FolderTreeNode>();
    const walk = (nodes: readonly FolderTreeNode[]) => {
      for (const node of nodes) {
        index.set(node.id, node);
        if (node.children) walk(node.children);
      }
    };
    walk(folders);
    return index;
  });

  /** Every folder that has something inside it — what the one open/close control acts on. */
  const expandableIds = $derived.by(() => {
    const found: string[] = [];
    const walk = (nodes: readonly FolderTreeNode[]) => {
      for (const node of nodes) {
        if (node.children && node.children.length > 0) {
          found.push(node.id);
          walk(node.children);
        }
      }
    };
    walk(folders);
    return found;
  });

  const allExpanded = $derived(
    expandableIds.length > 0 && expandableIds.every((id) => expandedFolderIds.includes(id)),
  );

  // The root row is a real row of the tree, so the tree is given one item: Home, holding the
  // folders. Its own open state lives here rather than in the caller's list, which names folders.
  let homeExpanded = $state(true);
  const rootNode = $derived({
    id: HOME_IDENTIFIER,
    label: homeLabel,
    children: folders as TreeNode[],
  } satisfies TreeNode);

  const treeExpandedIds = $derived(
    homeExpanded ? [HOME_IDENTIFIER, ...expandedFolderIds] : [...expandedFolderIds],
  );

  function applyExpanded(next: string[]) {
    homeExpanded = next.includes(HOME_IDENTIFIER);
    expandedFolderIds = next.filter((id) => id !== HOME_IDENTIFIER);
  }

  // A view being open means no folder is the current place, so nothing in the tree reads selected.
  const treeSelectedId = $derived(
    currentViewId !== undefined ? undefined : (selectedFolderId ?? HOME_IDENTIFIER),
  );

  function handleSelect(id: string) {
    const folderId = id === HOME_IDENTIFIER ? null : id;
    selectedFolderId = folderId;
    onSelectFolder?.(folderId);
  }

  function pressToggleAll(event: MouseEvent) {
    // The row this control sits in is a selectable row; the control acts on the tree, not on it.
    event.stopPropagation();
    homeExpanded = true;
    expandedFolderIds = allExpanded ? [] : [...expandableIds];
  }

  function pressNewFolder(event: MouseEvent) {
    event.stopPropagation();
    onNewFolder?.();
  }

  // --- the right-click, and the two flyouts --------------------------------------------------

  let menuTarget = $state<FolderTreeMenuTarget | null>(null);
  let contextTargetId = $state<string | undefined>(undefined);

  function identifierAt(target: EventTarget | null): string | null {
    return (
      (target as HTMLElement | null)
        ?.closest<HTMLElement>("[data-tree-item-id]")
        ?.getAttribute("data-tree-item-id") ?? null
    );
  }

  // Runs on the tree itself, so it has recorded which row the pointer was over by the time the
  // menu's own handler further up opens the panel.
  function rememberMenuTarget(event: MouseEvent) {
    const id = identifierAt(event.target);
    contextTargetId = id ?? undefined;
    if (id === null) {
      menuTarget = null;
      return;
    }
    menuTarget =
      id === HOME_IDENTIFIER
        ? { folderId: null, label: homeLabel }
        : { folderId: id, label: foldersById.get(id)?.label ?? "" };
  }

  const targetFolder = $derived(
    menuTarget?.folderId === undefined || menuTarget.folderId === null
      ? undefined
      : foldersById.get(menuTarget.folderId),
  );

  function chooseColor(color: FolderColorName) {
    const folderId = menuTarget?.folderId;
    if (folderId === null || folderId === undefined) return;
    onChangeColor?.({ folderId, color });
  }

  function chooseIcon(icon: FolderIconName) {
    const folderId = menuTarget?.folderId;
    if (folderId === null || folderId === undefined) return;
    onChangeIcon?.({ folderId, icon });
  }

  // --- dragging a folder somewhere else ------------------------------------------------------

  let draggedFolderId = $state<string | undefined>(undefined);
  let dragOverId = $state<string | undefined>(undefined);

  const markedId = $derived(dragOverId ?? contextTargetId);

  function destinationOf(id: string): string | null {
    return id === HOME_IDENTIFIER ? null : id;
  }

  function handleDragStart(event: DragEvent) {
    const id = identifierAt(event.target);
    // The root row is not a folder: nothing can move it, so the drag never starts.
    if (id === null || id === HOME_IDENTIFIER) {
      event.preventDefault();
      return;
    }
    draggedFolderId = id;
    event.dataTransfer?.setData("text/plain", id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(event: DragEvent) {
    const moving = draggedFolderId;
    if (moving === undefined) return;
    const over = identifierAt(event.target);
    if (over === null || !canMoveFolder(folders, moving, destinationOf(over))) {
      dragOverId = undefined;
      return;
    }
    // Not preventing the default is what refuses the drop, so a folder is never told it may land
    // somewhere it cannot go.
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    dragOverId = over;
  }

  function handleDragLeave(event: DragEvent) {
    if (identifierAt(event.target) === dragOverId) dragOverId = undefined;
  }

  function handleDrop(event: DragEvent) {
    event.preventDefault();
    const moving = draggedFolderId;
    const over = dragOverId;
    draggedFolderId = undefined;
    dragOverId = undefined;
    if (moving === undefined || over === undefined) return;
    onMoveFolder?.({ folderId: moving, destinationFolderId: destinationOf(over) });
  }

  function handleDragEnd() {
    draggedFolderId = undefined;
    dragOverId = undefined;
  }

  function handleMenuOpenChange(open: boolean) {
    if (!open) contextTargetId = undefined;
  }

  /** Placeholder rows while the folders are being fetched — keyed so the list is stable. */
  const LOADING_ROWS = ["first", "second", "third", "fourth", "fifth"];
</script>

<div bind:this={ref} class={mergeClasses("mc-folder-tree", className)} {...restProps}>
  <div class="mc-folder-tree-scroll mc-scrollbar">
    {#if loading}
      <p class="sr-only">Reading the folders</p>
      <div class="mc-folder-tree-loading" aria-busy="true" aria-hidden="true">
        {#each LOADING_ROWS as row (row)}
          <Skeleton class="mc-folder-tree-loading-row" />
        {/each}
      </div>
    {:else}
      <ContextMenu.Root onOpenChange={handleMenuOpenChange}>
        <ContextMenu.Trigger>
          <Tree
            items={[rootNode]}
            bind:expandedIds={() => treeExpandedIds, applyExpanded}
            selectedId={treeSelectedId}
            {label}
            expandOnActivate={false}
            draggableItems={true}
            {markedId}
            {icon}
            {trailing}
            onSelect={handleSelect}
            oncontextmenu={rememberMenuTarget}
            ondragstart={handleDragStart}
            ondragover={handleDragOver}
            ondragleave={handleDragLeave}
            ondrop={handleDrop}
            ondragend={handleDragEnd}
          />
        </ContextMenu.Trigger>
        <ContextMenu.Content class="mc-folder-tree-menu">
          {#if menuTarget && menuItems}
            {@render menuItems(menuTarget)}
          {/if}
          {#if targetFolder}
            {#if menuItems}
              <ContextMenu.Separator />
            {/if}
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger>
                <span
                  class="mc-folder-tree-pip"
                  data-folder-color={targetFolder.color ?? "none"}
                  aria-hidden="true"
                ></span>
                Color
              </ContextMenu.SubTrigger>
              <ContextMenu.SubContent class="mc-folder-tree-palette">
                {#each FOLDER_COLORS as color (color.name)}
                  <ContextMenu.Item
                    class="mc-folder-tree-swatch"
                    data-folder-color={color.name}
                    data-folder-ink={color.ink}
                    aria-label={color.label}
                    onSelect={() => chooseColor(color.name)}
                  >
                    {#if targetFolder.color === color.name}
                      <Check class="mc-folder-tree-swatch-check" aria-hidden="true" />
                    {/if}
                  </ContextMenu.Item>
                {/each}
              </ContextMenu.SubContent>
            </ContextMenu.Sub>
            <ContextMenu.Sub>
              <ContextMenu.SubTrigger>
                {@const Current = folderGlyph(targetFolder.icon, false)}
                <Current class="mc-folder-tree-menu-icon" aria-hidden="true" />
                Icon
              </ContextMenu.SubTrigger>
              <ContextMenu.SubContent>
                {#each FOLDER_ICONS as choice (choice.name)}
                  {@const Glyph = choice.closed}
                  <ContextMenu.Item onSelect={() => chooseIcon(choice.name)}>
                    <Glyph class="mc-folder-tree-menu-icon" aria-hidden="true" />
                    {choice.label}
                    {#if (targetFolder.icon ?? "plain") === choice.name}
                      <Check class="mc-folder-tree-menu-check" aria-hidden="true" />
                    {/if}
                  </ContextMenu.Item>
                {/each}
              </ContextMenu.SubContent>
            </ContextMenu.Sub>
          {/if}
        </ContextMenu.Content>
      </ContextMenu.Root>

      {#if folders.length === 0}
        <p class="mc-folder-tree-empty">{emptyMessage}</p>
      {/if}

      {#if views.length > 0}
        <Separator class="mc-folder-tree-separator" />
        <ul class="mc-folder-tree-views">
          {#each views as view (view.id)}
            {@const Glyph = view.icon}
            <li>
              <button
                type="button"
                class="mc-tree-item-row mc-folder-tree-view w-full"
                aria-current={view.id === currentViewId ? "page" : undefined}
                disabled={view.disabledReason !== undefined}
                title={view.disabledReason}
                onclick={() => onSelectView?.(view.id)}
              >
                <Glyph class="mc-folder-tree-view-icon" aria-hidden="true" />
                <span class="mc-folder-tree-view-label">{view.label}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</div>

{#snippet icon(context: TreeItemContext)}
  {#if context.node.id === HOME_IDENTIFIER}
    {@const Home = FOLDER_TREE_HOME_ICON}
    <Home class="mc-tree-item-icon mc-folder-tree-icon" aria-hidden="true" />
  {:else}
    {@const folder = foldersById.get(context.node.id)}
    <!-- The shared glyph, so this rail and every list that draws the same folder agree about what
         its colour and mark look like. -->
    <FolderGlyph
      class="mc-tree-item-icon mc-folder-tree-icon"
      color={folder?.color}
      icon={folder?.icon}
      open={context.expanded}
    />
  {/if}
{/snippet}

{#snippet trailing(context: TreeItemContext)}
  {#if context.node.id === HOME_IDENTIFIER}
    <button
      type="button"
      class="mc-folder-tree-control"
      aria-label={allExpanded ? "Collapse All" : "Expand All"}
      title={allExpanded ? "Collapse All" : "Expand All"}
      disabled={expandableIds.length === 0}
      onclick={pressToggleAll}
    >
      {#if allExpanded}
        <ChevronsDownUp class="mc-folder-tree-control-icon" aria-hidden="true" />
      {:else}
        <ChevronsUpDown class="mc-folder-tree-control-icon" aria-hidden="true" />
      {/if}
    </button>
    <button
      type="button"
      class="mc-folder-tree-control"
      aria-label="New Folder"
      title={newFolderDisabledReason ?? "New Folder"}
      disabled={newFolderDisabledReason !== undefined}
      onclick={pressNewFolder}
    >
      <FolderPlus class="mc-folder-tree-control-icon" aria-hidden="true" />
    </button>
  {:else if showFileCounts}
    {@const count = foldersById.get(context.node.id)?.fileCount}
    {#if count !== undefined}
      <span class="mc-folder-tree-count">{count}</span>
    {/if}
  {/if}
{/snippet}
