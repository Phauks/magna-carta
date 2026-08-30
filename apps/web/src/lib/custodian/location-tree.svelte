<script lang="ts">
  /*
   * The firm's container tree, with what is in each node.
   *
   * The register answers "where is the original will" and this is the other half of it: a browsable
   * tree of offices, safes, cabinets, shelves and boxes, plus the bank vaults and offsite stores
   * that are not the firm's own offices at all. Selecting a node narrows the register to everything
   * beneath it — the whole branch, because "what is in the Reno safe" has to include the boxes and
   * positions inside it, which is the point of having a tree.
   *
   * TWO COUNTS, NOT ONE, AND THEY DIFFER ON PURPOSE. A node carries what is physically at it and
   * what is at it or anywhere beneath it. A shelf whose contents are all checked out reads as empty,
   * because that is what a person standing in front of it would see: a packet that is out is at no
   * location at all.
   *
   * The glyph is per kind rather than a folder on every row. A tree of safes and bank vaults drawn
   * entirely in folders claims every node is a folder, which is the one thing this tree is not.
   */
  import type { Component } from "svelte";
  import Tree, { type TreeItemContext, type TreeNode } from "@magna-carta/design-system/tree";
  import Building2 from "@lucide/svelte/icons/building-2";
  import DoorClosed from "@lucide/svelte/icons/door-closed";
  import Vault from "@lucide/svelte/icons/vault";
  import Archive from "@lucide/svelte/icons/archive";
  import Rows3 from "@lucide/svelte/icons/rows-3";
  import Package from "@lucide/svelte/icons/package";
  import MapPin from "@lucide/svelte/icons/map-pin";
  import Truck from "@lucide/svelte/icons/truck";
  import Landmark from "@lucide/svelte/icons/landmark";
  import type { CustodyLocationOccupancy } from "./custody-api.ts";
  import { locationKindLabel, type CustodyLocationKind } from "./custody-vocabulary.ts";

  let {
    occupancy,
    selectedId = $bindable(undefined),
  }: {
    /** The tree with its counts, parents before children, as the report answers it. */
    occupancy: readonly CustodyLocationOccupancy[];
    /** The node whose branch the register is narrowed to, if any. */
    selectedId?: string | undefined;
  } = $props();

  const GLYPHS: Record<CustodyLocationKind, Component> = {
    office: Building2,
    room: DoorClosed,
    safe: Vault,
    cabinet: Archive,
    shelf: Rows3,
    box: Package,
    position: MapPin,
    offsite: Truck,
    bank: Landmark,
  };

  const byId = $derived(new Map(occupancy.map((node) => [node.locationId, node])));

  /** The flat report assembled into the nesting the tree renders. */
  const items = $derived.by(() => {
    const nodes = new Map<string, TreeNode>();
    for (const entry of occupancy) {
      nodes.set(entry.locationId, {
        id: entry.locationId,
        label: entry.name,
        children: [],
      });
    }
    const roots: TreeNode[] = [];
    for (const entry of occupancy) {
      const node = nodes.get(entry.locationId);
      if (node === undefined) continue;
      const parent = entry.parentLocationId === null ? undefined : nodes.get(entry.parentLocationId);
      // A node whose parent is not in the report is walked as its own root rather than dropped: a
      // container the reader cannot see is a container they will not look in.
      if (parent === undefined) roots.push(node);
      else parent.children?.push(node);
    }
    return roots;
  });

  let expandedIds = $state<string[]>([]);

  // Every branch that holds something opens on arrival. A tree of shut doors makes a person click
  // through the whole firm to find out where anything is.
  $effect(() => {
    const holding = occupancy
      .filter((node) => node.subtreeOccupancy > 0)
      .map((node) => node.locationId);
    if (holding.length > 0 && expandedIds.length === 0) expandedIds = holding;
  });
</script>

{#snippet icon(context: TreeItemContext)}
  {@const node = byId.get(context.node.id)}
  {@const Glyph = node === undefined ? MapPin : GLYPHS[node.kind]}
  <!-- The kind rides the glyph's own hover. It is what tells a safe from a bank vault, and it says
       so where the difference is drawn rather than in a legend nobody reads. -->
  <span title={node === undefined ? undefined : locationKindLabel(node.kind)}>
    <Glyph class="size-16" aria-hidden="true" />
  </span>
{/snippet}

{#snippet trailing(context: TreeItemContext)}
  {@const node = byId.get(context.node.id)}
  {#if node !== undefined}
    <span class="text-xs text-text-muted tabular-nums">
      {node.directOccupancy}
      {#if node.subtreeOccupancy !== node.directOccupancy}
        <span title="Here, and everywhere beneath it">of {node.subtreeOccupancy}</span>
      {/if}
    </span>
  {/if}
{/snippet}

<Tree
  {items}
  bind:expandedIds
  bind:selectedId
  label="The firm's custody locations"
  {icon}
  {trailing}
/>

<p class="text-xs text-text-muted">
  Each node shows what is physically at it, and where a branch holds more, what is at it or anywhere
  beneath it. A packet that is checked out is at no location, so a shelf whose contents are all out
  reads as empty.
</p>

{#if occupancy.length > 0}
  <p class="text-xs text-text-muted">
    {occupancy.filter((node) => node.status === "closed").length} of {occupancy.length} nodes are closed.
    A location holding packets cannot be closed, and one a packet has ever been in is closed rather than
    removed.
  </p>
{/if}
