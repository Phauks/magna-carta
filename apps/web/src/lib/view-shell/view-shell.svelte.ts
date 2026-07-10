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
import { SvelteSet } from "svelte/reactivity";
import type { PersistedPreference } from "$lib/preferences/persisted-preference.svelte.ts";
import type {
  RegionDefinition,
  RegionVisibility,
  SelectionController,
  ViewDefinition,
} from "./view-shell-types.ts";

export interface ViewShellConfig<Item, ViewId extends string> {
  /** The registered views, in the order the switch presents them; at least one. */
  readonly views: readonly ViewDefinition<Item, ViewId>[];
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
}

export interface ViewShellController<Item, ViewId extends string = string> {
  readonly views: readonly ViewDefinition<Item, ViewId>[];
  readonly activeViewId: ViewId;
  readonly activeView: ViewDefinition<Item, ViewId>;
  setActiveView(id: ViewId): void;
  readonly items: readonly Item[];
  readonly selection: SelectionController<Item>;
  readonly regions: readonly RegionDefinition[];
  isRegionShown(id: string): boolean;
  setRegionShown(id: string, shown: boolean): void;
  toggleRegion(id: string): void;
}

export function createViewShell<Item, ViewId extends string>(
  config: ViewShellConfig<Item, ViewId>,
): ViewShellController<Item, ViewId> {
  if (config.views.length === 0) {
    throw new Error("A view shell needs at least one registered view.");
  }
  const views = config.views;
  const firstView = views[0]!;
  const isRegisteredView = (id: ViewId): boolean => views.some((view) => view.id === id);
  const itemsOf = config.items ?? ((): readonly Item[] => []);
  const keyOf = config.itemKey ?? ((item: Item): string => String(item));

  const activeViewPreference = config.activeViewPreference;
  // A stored id no longer in the registry (a retired view, a hand edit) resolves to the first
  // registered view rather than rendering nothing.
  const resolveActiveId = (): ViewId =>
    isRegisteredView(activeViewPreference.current) ? activeViewPreference.current : firstView.id;

  const selectedKeys = new SvelteSet<string>();
  const selection: SelectionController<Item> = {
    get selectedKeys(): ReadonlySet<string> {
      return selectedKeys;
    },
    get selectedItems(): readonly Item[] {
      return itemsOf().filter((item) => selectedKeys.has(keyOf(item)));
    },
    get count(): number {
      return selectedKeys.size;
    },
    get isEmpty(): boolean {
      return selectedKeys.size === 0;
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
  const isRegionShown = (id: string): boolean => {
    const region = regions.find((candidate) => candidate.id === id);
    if (region === undefined) return false;
    const stored = regionsPreference?.current[id];
    return typeof stored === "boolean" ? stored : region.defaultShown;
  };
  const setRegionShown = (id: string, shown: boolean): void => {
    if (regionsPreference === undefined) return;
    if (!regions.some((candidate) => candidate.id === id)) return;
    regionsPreference.set({ ...regionsPreference.current, [id]: shown });
  };

  return {
    views,
    get activeViewId(): ViewId {
      return resolveActiveId();
    },
    get activeView(): ViewDefinition<Item, ViewId> {
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
    regions,
    isRegionShown,
    setRegionShown,
    toggleRegion(id: string): void {
      setRegionShown(id, !isRegionShown(id));
    },
  };
}
