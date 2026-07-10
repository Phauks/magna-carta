<script module lang="ts">
  /** One node in a Tree. A node with a non-empty `children` array is a parent (it gets a
   * twisty and an `aria-expanded` state); a node without children is a leaf. */
  export type TreeNode = {
    /** Stable identity — the selection value, the expansion key, and the focus target. */
    id: string;
    /** The visible label; also the treeitem's accessible name and the typeahead key. */
    label: string;
    /** Child nodes. A non-empty array makes this an expandable parent. */
    children?: TreeNode[];
  };
</script>

<script lang="ts">
  /*
   * Tree — a folder tree with the full WAI-ARIA tree view keyboard model (Tier 1: native elements,
   * NO Bits UI — bits-ui 2.18.1 ships no Tree primitive, so the roving-tabindex/typeahead behaviour
   * is built here). Data-driven from a `items` array of TreeNode, rendered as a nested
   * role="tree" > role="treeitem" > role="group" structure with `aria-level`, `aria-setsize`,
   * `aria-posinset`, `aria-expanded`, and `aria-selected`.
   *
   * Keyboard (WAI-ARIA tree view): a single roving tabindex (one treeitem is tabbable, the rest are
   * -1); Up/Down move between VISIBLE nodes; Right expands a collapsed parent or descends into an
   * expanded one; Left collapses an expanded parent or ascends to the parent; Home/End jump to the
   * first/last visible node; a printable key does first-character typeahead; Enter/Space activate
   * (select, and toggle a parent's expansion). Focus is moved imperatively to the active treeitem
   * after each move; the tabindex follows reactively.
   *
   * Expansion is CONTROLLED — `expandedIds` is a bindable array so the consumer persists which
   * folders are open (the Files surface remembers the open set across navigations). `selectedId` is
   * bindable too. Expansion changes are a layout change, so they are INSTANT (no height animation) —
   * the design language forbids animating layout; only the twisty glyph swaps.
   */
  import { tick } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Folder from "@lucide/svelte/icons/folder";
  import FolderOpen from "@lucide/svelte/icons/folder-open";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    items,
    expandedIds = $bindable([]),
    selectedId = $bindable(undefined),
    label = "Folders",
    onSelect,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLUListElement>, HTMLUListElement> & {
    /** The tree data, root nodes first. */
    items: TreeNode[];
    /** The ids of the currently-expanded parents. Bindable so the consumer persists the open set. */
    expandedIds?: string[];
    /** The id of the selected node, or `undefined` when nothing is selected. Bindable. */
    selectedId?: string | undefined;
    /** Accessible name for the tree landmark (role="tree"). */
    label?: string;
    /** Called with the node id whenever a node is activated (selected). */
    onSelect?: (id: string) => void;
  } = $props();

  type VisibleNode = {
    node: TreeNode;
    level: number;
    hasChildren: boolean;
    expanded: boolean;
    setsize: number;
    posinset: number;
    parentId: string | undefined;
  };

  const expandedSet = $derived(new Set(expandedIds));

  // The depth-first list of nodes the user can currently see and move between — the keyboard model
  // navigates THIS flat order, while the markup below renders the same data nested for indentation.
  const visible = $derived.by(() => {
    const out: VisibleNode[] = [];
    const walk = (nodes: TreeNode[], level: number, parentId: string | undefined) => {
      nodes.forEach((node, index) => {
        const hasChildren = node.children !== undefined && node.children.length > 0;
        const expanded = hasChildren && expandedSet.has(node.id);
        out.push({
          node,
          level,
          hasChildren,
          expanded,
          setsize: nodes.length,
          posinset: index + 1,
          parentId,
        });
        if (expanded && node.children) walk(node.children, level + 1, node.id);
      });
    };
    walk(items, 1, undefined);
    return out;
  });

  // The roving-tabindex target. When it falls out of the visible set (a collapse hid it, or the data
  // changed), it falls back to the first visible node so exactly one treeitem is always tabbable.
  let activeId = $state<string | undefined>(undefined);
  const effectiveActiveId = $derived(
    visible.some((entry) => entry.node.id === activeId) ? activeId : visible[0]?.node.id,
  );

  function itemSelector(id: string): string {
    const escaped = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(id) : id;
    return `[data-tree-item-id="${escaped}"]`;
  }

  async function focusNode(id: string | undefined) {
    if (id === undefined) return;
    activeId = id;
    // Right-into-a-just-expanded-child reveals new DOM; wait for the render before focusing it.
    await tick();
    ref?.querySelector<HTMLElement>(itemSelector(id))?.focus();
  }

  function setExpanded(id: string, open: boolean) {
    const has = expandedIds.includes(id);
    if (open && !has) expandedIds = [...expandedIds, id];
    else if (!open && has) expandedIds = expandedIds.filter((entry) => entry !== id);
  }

  function activate(entry: VisibleNode) {
    selectedId = entry.node.id;
    onSelect?.(entry.node.id);
    if (entry.hasChildren) setExpanded(entry.node.id, !entry.expanded);
  }

  let typeaheadBuffer = "";
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

  function typeahead(character: string, fromIndex: number) {
    clearTimeout(typeaheadTimer);
    typeaheadBuffer += character.toLowerCase();
    typeaheadTimer = setTimeout(() => (typeaheadBuffer = ""), 500);
    // A single character searches from the NEXT node (so a repeated key cycles matches); a growing
    // buffer re-matches from the current node so the prefix narrows in place.
    const startIndex = typeaheadBuffer.length > 1 ? fromIndex : fromIndex + 1;
    for (let step = 0; step < visible.length; step++) {
      const candidate = visible[(startIndex + step) % visible.length];
      if (candidate && candidate.node.label.toLowerCase().startsWith(typeaheadBuffer)) {
        focusNode(candidate.node.id);
        return;
      }
    }
  }

  function treeItemId(target: EventTarget | null): string | null {
    return (
      (target as HTMLElement | null)?.closest<HTMLElement>("[data-tree-item-id]")
        ?.getAttribute("data-tree-item-id") ?? null
    );
  }

  // Keep the roving-tabindex target in step with real focus — whenever focus enters a treeitem (by
  // Tab, by a click, or programmatically), the active node follows it, so the keyboard handler always
  // acts on the node the user is actually on.
  function onfocusin(event: FocusEvent) {
    const id = treeItemId(event.target);
    if (id !== null) activeId = id;
  }

  // Click is delegated to the tree root (which also owns keydown) so the treeitem <li> carries no
  // handler of its own — the nearest treeitem to the pointer is the one activated.
  function onclick(event: MouseEvent) {
    const id = treeItemId(event.target);
    if (id === null) return;
    const entry = visible.find((candidate) => candidate.node.id === id);
    if (entry === undefined) return;
    activeId = id;
    activate(entry);
  }

  function onkeydown(event: KeyboardEvent) {
    const currentId = effectiveActiveId;
    if (currentId === undefined) return;
    const index = visible.findIndex((entry) => entry.node.id === currentId);
    if (index === -1) return;
    const current = visible[index];
    if (current === undefined) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusNode(visible[index + 1]?.node.id);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusNode(visible[index - 1]?.node.id);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (current.hasChildren && !current.expanded) setExpanded(current.node.id, true);
        else if (current.hasChildren && current.expanded) focusNode(visible[index + 1]?.node.id);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (current.hasChildren && current.expanded) setExpanded(current.node.id, false);
        else focusNode(current.parentId);
        break;
      case "Home":
        event.preventDefault();
        focusNode(visible[0]?.node.id);
        break;
      case "End":
        event.preventDefault();
        focusNode(visible[visible.length - 1]?.node.id);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        activate(current);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          typeahead(event.key, index);
        }
    }
  }
</script>

<ul
  bind:this={ref}
  role="tree"
  aria-label={label}
  class={mergeClasses("mc-tree", className)}
  {onkeydown}
  {onclick}
  {onfocusin}
  {...restProps}
>
  {@render nodes(items, 1)}
</ul>

{#snippet nodes(list: TreeNode[], level: number)}
  {#each list as node, index (node.id)}
    {@const hasChildren = node.children !== undefined && node.children.length > 0}
    {@const expanded = hasChildren && expandedSet.has(node.id)}
    {@const selected = node.id === selectedId}
    <li
      role="treeitem"
      aria-level={level}
      aria-setsize={list.length}
      aria-posinset={index + 1}
      aria-selected={selected}
      aria-expanded={hasChildren ? expanded : undefined}
      aria-label={node.label}
      tabindex={node.id === effectiveActiveId ? 0 : -1}
      data-tree-item-id={node.id}
      class="mc-tree-item"
    >
      <span class="mc-tree-item-row">
        <span class="mc-tree-item-twisty">
          {#if hasChildren}
            {#if expanded}
              <ChevronDown class="mc-tree-item-twisty-icon" aria-hidden="true" />
            {:else}
              <ChevronRight class="mc-tree-item-twisty-icon" aria-hidden="true" />
            {/if}
          {/if}
        </span>
        {#if hasChildren && expanded}
          <FolderOpen class="mc-tree-item-icon" aria-hidden="true" />
        {:else}
          <Folder class="mc-tree-item-icon" aria-hidden="true" />
        {/if}
        <span class="mc-tree-item-label">{node.label}</span>
      </span>
      {#if hasChildren && expanded && node.children}
        <ul role="group" class="mc-tree-group">
          {@render nodes(node.children, level + 1)}
        </ul>
      {/if}
    </li>
  {/each}
{/snippet}
