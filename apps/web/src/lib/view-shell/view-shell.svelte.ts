/*
 * The multi-view shell's controller — the reactive core the view-switch and body components read.
 * It owns three things the spec calls out: the active view over a registry, one shared selection,
 * and the regions record. View and region choices persist through the persisted-preference
 * primitive (the injected stores), so the shell holds no localStorage logic of its own; a consumer
 * that wants its view choice remembered passes a preference, and Files passes a second for regions.
 *
 * Selection is in-memory session state (a fresh page open starts unselected), keyed by the
 * consumer's `itemKey` so it survives the items array being rebuilt.
 */
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import type { PersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import type {
  RegionDefinition,
  RegionVisibility,
  SelectionController,
  ViewDefinition,
} from "./view-shell-types.ts";

export interface ViewShellConfig<Item, ViewId extends string, Context = undefined> {
  /** The registered views, in the order the switch presents them; at least one. */
  readonly views: readonly ViewDefinition<Item, ViewId, Context>[];
  /** Where the active-view choice is read and persisted. */
  readonly activeViewPreference: PersistedPreference<ViewId>;
  /** The current items, as a reactive getter so the shell tracks changes. Defaults to none. */
  readonly items?: () => readonly Item[];
  /** Selection identity for an item. Defaults to its string form. */
  readonly itemKey?: (item: Item) => string;
  /** The optional regions flanking the content view. Defaults to none. */
  readonly regions?: readonly RegionDefinition[];
  /** Where the regions record is read and persisted. Required to remember region toggles. */
  readonly regionsPreference?: PersistedPreference<RegionVisibility>;
  /**
   * Host capabilities handed to every view, as a reactive getter so a view re-reads them when they
   * change (the file surface passes its sort this way). A host with none omits it.
   */
  readonly context?: () => Context;
}

export interface ViewShellController<Item, ViewId extends string = string, Context = undefined> {
  readonly views: readonly ViewDefinition<Item, ViewId, Context>[];
  readonly activeViewId: ViewId;
  readonly activeView: ViewDefinition<Item, ViewId, Context>;
  setActiveView(id: ViewId): void;
  readonly items: readonly Item[];
  readonly selection: SelectionController<Item>;
  readonly context: Context;
  readonly regions: readonly RegionDefinition[];
  isRegionShown(id: string): boolean;
  setRegionShown(id: string, shown: boolean): void;
  toggleRegion(id: string): void;
}

export function createViewShell<Item, ViewId extends string, Context = undefined>(
  config: ViewShellConfig<Item, ViewId, Context>,
): ViewShellController<Item, ViewId, Context> {
  if (config.views.length === 0) {
    throw new Error("A view shell needs at least one registered view.");
  }
  const views = config.views;
  const firstView = views[0]!;
  const isRegisteredView = (id: ViewId): boolean => views.some((view) => view.id === id);
  const itemsOf = config.items ?? ((): readonly Item[] => []);
  const keyOf = config.itemKey ?? ((item: Item): string => String(item));
  // A host with no capabilities to pass yields `undefined`, which is exactly the default Context.
  const contextOf = config.context ?? ((): Context => undefined as Context);

  const activeViewPreference = config.activeViewPreference;
  // A stored id no longer in the registry (a retired view, a hand edit) resolves to the first
  // registered view rather than rendering nothing.
  const resolveActiveId = (): ViewId =>
    isRegisteredView(activeViewPreference.current) ? activeViewPreference.current : firstView.id;

  // `selectedKeys` holds the user's raw intent. Everything OBSERVABLE about the selection —
  // `count`, `isEmpty`, `selectedItems`, the `selectedKeys` view — is reconciled against the CURRENT
  // items, so a key whose item has left the list (a folder change, a deletion, a filter) neither
  // counts nor can be acted on, and `count` can never disagree with `selectedItems`. Reconciling on
  // read (rather than pruning the raw set) means a filtered-out item that returns is still selected;
  // a consumer that wants selection dropped on true navigation calls `clear()` at that boundary.
  const selectedKeys = new SvelteSet<string>();
  const presentSelectedItems = (): readonly Item[] =>
    itemsOf().filter((item) => selectedKeys.has(keyOf(item)));
  const selection: SelectionController<Item> = {
    get selectedKeys(): ReadonlySet<string> {
      return new Set(presentSelectedItems().map(keyOf));
    },
    get selectedItems(): readonly Item[] {
      return presentSelectedItems();
    },
    get count(): number {
      return presentSelectedItems().length;
    },
    get isEmpty(): boolean {
      return presentSelectedItems().length === 0;
    },
    isSelected(item: Item): boolean {
      return selectedKeys.has(keyOf(item));
    },
    select(item: Item): void {
      selectedKeys.clear();
      selectedKeys.add(keyOf(item));
    },
    toggle(item: Item): void {
      const key = keyOf(item);
      if (selectedKeys.has(key)) selectedKeys.delete(key);
      else selectedKeys.add(key);
    },
    clear(): void {
      selectedKeys.clear();
    },
  };

  const regions = config.regions ?? [];
  const regionsPreference = config.regionsPreference;
  // When a preference is injected it is the durable home for region visibility. Without one, a
  // consumer still gets SESSION toggling (a fresh open starts at each region's default) — otherwise
  // defining a region without a preference would freeze it, toggleable only if remembered.
  const sessionRegionOverrides = new SvelteMap<string, boolean>();
  const isRegionShown = (id: string): boolean => {
    const region = regions.find((candidate) => candidate.id === id);
    if (region === undefined) return false;
    const stored = regionsPreference
      ? regionsPreference.current[id]
      : sessionRegionOverrides.get(id);
    return typeof stored === "boolean" ? stored : region.defaultShown;
  };
  const setRegionShown = (id: string, shown: boolean): void => {
    if (!regions.some((candidate) => candidate.id === id)) return;
    if (regionsPreference !== undefined) {
      regionsPreference.set({ ...regionsPreference.current, [id]: shown });
    } else {
      sessionRegionOverrides.set(id, shown);
    }
  };

  return {
    views,
    get activeViewId(): ViewId {
      return resolveActiveId();
    },
    get activeView(): ViewDefinition<Item, ViewId, Context> {
      const active = resolveActiveId();
      return views.find((view) => view.id === active) ?? firstView;
    },
    setActiveView(id: ViewId): void {
      if (!isRegisteredView(id)) return;
      if (activeViewPreference.current === id) return;
      activeViewPreference.set(id);
    },
    get items(): readonly Item[] {
      return itemsOf();
    },
    selection,
    get context(): Context {
      return contextOf();
    },
    regions,
    isRegionShown,
    setRegionShown,
    toggleRegion(id: string): void {
      setRegionShown(id, !isRegionShown(id));
    },
  };
}
