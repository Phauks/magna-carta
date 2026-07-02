/*
 * createSvelteTable — the reactive bridge from headless @tanstack/table-core to Svelte 5 runes.
 * table-core is framework-agnostic and imperative: it holds its state in `options.state` and asks
 * the host to re-feed it via `onStateChange`. This wrapper parks that state in a `$state` rune and
 * keeps `table.setOptions` in sync through an `$effect.pre`, so the table instance the caller renders
 * (`table.getHeaderGroups()`, `table.getRowModel()`, …) recomputes whenever sorting/selection/
 * visibility change — table-core reads the `$state` proxy during those computations, so the reads are
 * tracked by the rendering effect. The caller supplies the row models it wants (getCoreRowModel,
 * getSortedRowModel, …); this module adds no feature it didn't ask for.
 *
 * Adapter shape proven by the shadcn-svelte data-table recipe; kept thin so the table-core API stays
 * the contract. (Swap to the official @tanstack/svelte-table once its v9 Svelte 5 adapter is stable —
 * this module is the single seam.)
 */
import {
  type RowData,
  type TableOptions,
  type TableOptionsResolved,
  type TableState,
  type Updater,
  createTable,
} from "@tanstack/table-core";

export function createSvelteTable<TData extends RowData>(options: TableOptions<TData>) {
  const resolvedOptions: TableOptionsResolved<TData> = mergeObjects(
    {
      state: {},
      onStateChange() {},
      renderFallbackValue: null,
      mergeOptions: (defaultOptions: TableOptions<TData>, options: Partial<TableOptions<TData>>) =>
        mergeObjects(defaultOptions, options),
    },
    options,
  );

  const table = createTable(resolvedOptions);
  let state = $state<TableState>(table.initialState);

  function updateOptions() {
    table.setOptions(() =>
      mergeObjects(resolvedOptions, options, {
        state: mergeObjects(state, options.state ?? {}),
        onStateChange: (updater: Updater<TableState>) => {
          state = updater instanceof Function ? updater(state) : mergeObjects(state, updater);
          options.onStateChange?.(updater);
        },
      }),
    );
  }

  updateOptions();

  $effect.pre(() => {
    updateOptions();
  });

  return table;
}

type MaybeThunk<T extends object> = T | (() => T | null | undefined);
type Intersection<T extends readonly unknown[]> = (T extends [infer Head, ...infer Rest]
  ? Head & Intersection<Rest>
  : unknown) & {};

/**
 * Lazily merges objects (or thunks) while preserving every source's getter semantics — later sources
 * win per key. A Proxy (rather than an eager spread) is what lets table-core read live `$state`
 * through the merged options without snapshotting it, and sidesteps a WebKit spread-recursion bug.
 * The sources are table-core option/state objects (no index signature), so the bodies index through
 * `Record<PropertyKey, unknown>` casts — the public return type stays the exact intersection.
 */
export function mergeObjects<Sources extends readonly MaybeThunk<object>[]>(
  ...sources: Sources
): Intersection<{ [K in keyof Sources]: Sources[K] }> {
  const resolve = (
    source: MaybeThunk<object> | undefined,
  ): Record<PropertyKey, unknown> | undefined =>
    (typeof source === "function" ? (source() ?? undefined) : source) as
      | Record<PropertyKey, unknown>
      | undefined;

  const findSourceWithKey = (key: PropertyKey) => {
    for (let index = sources.length - 1; index >= 0; index--) {
      const object = resolve(sources[index]);
      if (object && key in object) return object;
    }
    return undefined;
  };

  return new Proxy(Object.create(null), {
    get(_, key) {
      return findSourceWithKey(key)?.[key];
    },
    has(_, key) {
      return !!findSourceWithKey(key);
    },
    ownKeys(): (string | symbol)[] {
      const all = new Set<string | symbol>();
      for (const source of sources) {
        const object = resolve(source);
        if (object) for (const key of Reflect.ownKeys(object)) all.add(key);
      }
      return [...all];
    },
    getOwnPropertyDescriptor(_, key) {
      const source = findSourceWithKey(key);
      if (!source) return undefined;
      return { configurable: true, enumerable: true, value: source[key], writable: true };
    },
  }) as Intersection<{ [K in keyof Sources]: Sources[K] }>;
}
