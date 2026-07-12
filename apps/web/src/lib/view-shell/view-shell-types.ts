/*
 * The multi-view shell's vocabulary — the types a consumer registers against, kept free of runes
 * so they import anywhere (a page, the controller, a test). The shell is the shared body behind
 * the file surface: a matter's Files page, the Tools workbench, and a future discovery view each
 * present the same items through a registry of interchangeable views, with optional side regions
 * and one shared selection. The shell renders no masthead or title of its own — it is headerless;
 * the host supplies the chrome above it.
 */
import type { Component } from "svelte";

/**
 * The props every registered view receives: the current items, the shared selection over them, and
 * whatever capabilities the HOST hands down. A view free to ignore any of these (an unselectable
 * directory, say) simply does not declare it.
 *
 * `context` is the seam for a capability that belongs to the host rather than to a view — the file
 * surface's sort is the motivating case. Sorting is a property of the QUERY, not of a presentation:
 * a grid ordered newest-first is the same answer as a chronological list. So the host owns the sort
 * and passes it down, and every view can offer it rather than one view re-implementing it.
 */
export interface ViewRenderProps<Item, Context = undefined> {
  items: readonly Item[];
  selection: SelectionController<Item>;
  context: Context;
}

/**
 * One registrable view — a way to present the same items. `list`, `tiles`, `timeline`, and
 * `gallery` are the four the file surface offers, but the shell hardcodes none: a consumer
 * registers exactly the views it supports.
 */
export interface ViewDefinition<Item, ViewId extends string = string, Context = undefined> {
  readonly id: ViewId;
  /** Human label, used for the view-switch control's accessible name. */
  readonly label: string;
  /** A Lucide icon component for the view-switch control. */
  readonly icon: Component;
  /** The component that renders the items in this view. */
  readonly view: Component<ViewRenderProps<Item, Context>>;
}

/** One optional region flanking the content view (a folder tree, a details panel). */
export interface RegionDefinition {
  readonly id: string;
  readonly label: string;
  /** A Lucide icon component for a region toggle the host may render. */
  readonly icon: Component;
  /** Whether the region shows before the member has toggled it. */
  readonly defaultShown: boolean;
}

/** Which regions are shown, keyed by region id — the persisted regions record. */
export type RegionVisibility = Record<string, boolean>;

/**
 * The selection over the current items — single-select (`select` replaces) and multi-select
 * (`toggle` adds or removes), read by whichever view is active. Membership is by the shell's
 * `itemKey`, so a selection survives an items reference changing as long as the keys do.
 */
export interface SelectionController<Item> {
  readonly selectedKeys: ReadonlySet<string>;
  readonly selectedItems: readonly Item[];
  readonly count: number;
  readonly isEmpty: boolean;
  isSelected(item: Item): boolean;
  /** Replace the whole selection with just this item. */
  select(item: Item): void;
  /** Add the item if absent, remove it if present (multi-select). */
  toggle(item: Item): void;
  clear(): void;
}
