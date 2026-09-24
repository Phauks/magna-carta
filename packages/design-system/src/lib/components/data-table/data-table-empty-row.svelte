<script lang="ts">
  /*
   * The empty row — one row, one cell spanning every column, holding the words a table says when it
   * is holding nothing.
   *
   * Where data will arrive, the table that will hold it renders first: the header row from the
   * first paint and this row beneath it, so a reader meets the shape before the rows do and a
   * defect in a table that is already standing is visible where a defect behind a sentence is not.
   * DataTable.Grid composes exactly this for itself and says "No Results" without being asked; this
   * is the same part for the tables that are composed by hand, so the two cannot drift.
   *
   * It is NOT a row. `data-placeholder` is what withholds the hover fill and the pointer cursor —
   * both promise something to select, and there is nothing here to select. The content is ONE short
   * line in the table's muted register: the paragraph explaining what the noun means belongs in the
   * user guide, not under a header row.
   */
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import Cell from "./table-cell.svelte";
  import Row from "./table-row.svelte";

  let {
    columns,
    title,
    class: className,
  }: {
    /** How many columns the table is showing, so the one cell spans all of them. */
    columns: number;
    /** What the emptiness is, in the house voice — one line, no explanation of the noun. */
    title: string;
    class?: string;
  } = $props();
</script>

<Row data-placeholder="true">
  <Cell colspan={columns} class={mergeClasses("mc-table-empty", className)}>
    <!-- The grid's own empty-state recipe, so a hand-composed table's empty body reads exactly as
         the one table's does and holds the same height. -->
    <div class="mc-table-grid-empty"><p>{title}</p></div>
  </Cell>
</Row>
