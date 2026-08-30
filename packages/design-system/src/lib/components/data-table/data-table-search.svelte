<script lang="ts" generics="TData">
  /*
   * DataTable.Search — the one-line way to give a client-side table the screen's search. It is
   * ScopedSearch bound to the table's global filter, and nothing more: the appearance and the
   * behaviour (rests as an icon, expands on use, collapses when left empty, keeps itself open with
   * the accent edge while a query is live) are the component's, so a table inherits the shape
   * rather than re-deciding it.
   *
   * Composable on purpose: it takes the shared table instance and drives its global filter, so it
   * sits in the screen's action row rather than being baked into the table. Requires the table to
   * have a filtered row model (`getFilteredRowModel()`); table-core's default global filter
   * substring-matches across the visible columns.
   *
   * This is the CLIENT-SIDE binding. A screen whose search runs on the server reaches for
   * ScopedSearch directly and sends the query itself — same control, same appearance, different
   * transport.
   */
  import type { Table } from "@tanstack/table-core";
  import ScopedSearch from "../scoped-search/index.ts";
  import type { InputSize } from "../input/variants.ts";

  type Props = {
    table: Table<TData>;
    /** Accessible name for the control. Name the surface: "Search matters". */
    label?: string;
    /** Hint text shown while the field is empty (not an accessible label). */
    placeholder?: string;
    /** Whether the field is showing. Bindable, so a screen can open the control itself. */
    expanded?: boolean;
    /** Renders the filtered-of-total count inside the field while a query is live. */
    showMatchCount?: boolean;
    /** Key that expands and focuses the control from anywhere on the page. Pass null for none. */
    shortcut?: string | null;
    /** Control height, from the same scale the Button and Input use. */
    size?: InputSize;
    /** Width utility for the expanded field. */
    fieldClass?: string;
    class?: string;
  };

  let {
    table,
    label = "Search this list",
    placeholder = "Search",
    expanded = $bindable(false),
    showMatchCount = true,
    shortcut = "/",
    size = "default",
    fieldClass,
    class: className,
  }: Props = $props();

  const query = $derived((table.getState().globalFilter ?? "") as string);
  // The count reads the row models rather than a stored number, so it can never drift from what the
  // table is actually showing.
  const matchSummary = $derived.by(() => {
    if (!showMatchCount || query.trim() === "") return undefined;
    return `${table.getFilteredRowModel().rows.length} of ${table.getCoreRowModel().rows.length}`;
  });
</script>

<ScopedSearch
  bind:value={() => query, (next) => table.setGlobalFilter(next)}
  bind:expanded
  {label}
  {placeholder}
  {matchSummary}
  {shortcut}
  {size}
  {fieldClass}
  class={className}
/>
