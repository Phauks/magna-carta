<script lang="ts">
  /*
   * The template library's listing — the firm's catalogue on the platform's one table.
   *
   * It reads through the generated infinite listing rather than a hand-written transport, so the
   * first page is the one this route's load already warmed and the rest arrive as the reader asks
   * for them. Sorting, the per-column filters, column show/hide, reorder, pinning and resize are the
   * grid's; the column model (template-columns.ts) declares what each column is; this component
   * owns only fetching and rendering.
   *
   * THE LISTING SERVES ONE STATUS AT A TIME, so the archived templates are a SECOND read rather
   * than a filter over the first. The reader asks for them at the foot of the list, after everything
   * the list is for has been read, and the rows are simply concatenated: the table sorts, so the
   * order the two reads arrived in is irrelevant. The Standing column then narrows across both.
   *
   * An empty catalogue is the grid's own "No Results" (owner ruling, 2026-09-14): the create control
   * is in the masthead by the product's grammar, and prose naming it here would duplicate a label
   * that is free to change without the prose changing with it.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { createInfiniteQuery } from "@tanstack/svelte-query";
  import { templatesListInfiniteOptions, type TemplateSummary } from "@magna-carta/api-client";
  import { failureOf } from "$lib/api/api-client.ts";
  import { paged } from "$lib/api/screen-data.ts";
  import {
    standingPresentation,
    templateColumns,
    templateStanding,
    TEMPLATE_INITIAL_SORT,
    type TemplateVocabulary,
  } from "./template-columns.ts";

  let {
    vocabulary,
    search = "",
    caption,
    grid = $bindable(null),
    onOpenTemplate,
  }: {
    /** The firm's practice areas and Locations, read once by the surface and joined here. */
    vocabulary: TemplateVocabulary;
    /**
     * The server's own search over the whole catalogue, by name or description. A change is a
     * different question and a fresh read, never a narrowing of the rows in hand — the listing is
     * paged, so filtering what has loaded would answer confidently about a fraction of it.
     */
    search?: string;
    /** The table's accessible caption — what this particular listing is. */
    caption: string;
    /**
     * The grid, handed back to the surface so the clear-filters control can sit in the screen's
     * one action row rather than in a second strip above the table.
     */
    grid?: DataTable.DataTableGridState<TemplateSummary> | null;
    /**
     * Open one template. The window belongs to the surface rather than to this listing, so every
     * door into a template opens the SAME window.
     */
    onOpenTemplate: (template: TemplateSummary) => void;
  } = $props();

  let showArchived = $state(false);

  // Blank means unfiltered, and is left OUT of the query rather than sent as "": the load warms the
  // listing without a search, and the same key is what lets this read find that warm answer.
  const asked = $derived(search.trim() === "" ? {} : { search: search.trim() });

  const activeRead = createInfiniteQuery(() =>
    paged(templatesListInfiniteOptions({ query: { status: "active", ...asked } })),
  );
  // Read only once asked for: a firm's archived templates are rows most visits never look at.
  const archivedRead = createInfiniteQuery(() => ({
    ...paged(templatesListInfiniteOptions({ query: { status: "archived", ...asked } })),
    enabled: showArchived,
  }));

  const activeRows = $derived(activeRead.data?.pages.flatMap((page) => page.data) ?? null);
  const archivedRows = $derived(
    showArchived ? (archivedRead.data?.pages.flatMap((page) => page.data) ?? []) : [],
  );
  const rows = $derived(activeRows === null ? null : [...activeRows, ...archivedRows]);

  const loadFailure = $derived(activeRead.error === null ? null : failureOf(activeRead.error));
  // The archived read failing leaves the catalogue readable; only the widening is refused.
  const archivedFailure = $derived(
    showArchived && archivedRead.error !== null ? failureOf(archivedRead.error) : null,
  );

  grid = DataTable.createDataTableGrid<TemplateSummary>({
    columns: () => templateColumns(vocabulary),
    rows: () => rows ?? [],
    rowKey: (template) => template.templateId,
    initialSort: TEMPLATE_INITIAL_SORT,
    itemNoun: { singular: "template", plural: "templates" },
    // Double-click and Enter open the template, anywhere on the row.
    onActivate: (template) => onOpenTemplate(template),
  });
  // Bound out above, and read back here so the markup below does not have to narrow a nullable
  // prop on every reference. The grid is created once, at init, and never replaced.
  const ownGrid = grid;
</script>

{#snippet templateCell({ row, column, text }: DataTable.GridCellContext<TemplateSummary>)}
  {#if column.id === "standing"}
    {@const presentation = standingPresentation(templateStanding(row))}
    <Badge variant={presentation.tone} title={presentation.meaning}>{presentation.label}</Badge>
  {:else if text === ""}
    <span class="text-text-muted">—</span>
  {:else}
    {text}
  {/if}
{/snippet}

<!-- The row's second line: the whole description, wrapping across the row's own width. A template
     with none written has no second line rather than a blank one. -->
{#snippet rowDetail(row: TemplateSummary)}
  {#if row.description !== null && row.description.trim() !== ""}
    <p class="w-full whitespace-pre-wrap text-sm text-text-muted">{row.description}</p>
  {/if}
{/snippet}

<div class="flex min-h-0 flex-1 flex-col gap-16">
  {#if loadFailure !== null}
    <!-- The failure RECORD goes to the standard surface, which reads the server's own words — a
         member refused by documents:assemble sees that refusal, with its Error ID — and falls back
         to this listing's sentence only where the server sent none. -->
    <FailureNotice
      failure={loadFailure}
      title="The Template Library Could Not Be Read"
      fallback="The firm's templates could not be read."
      whenSilent="Nothing answered when the template library was asked for."
      onRetry={() => void activeRead.refetch()}
    />
  {:else}
    {#if archivedFailure !== null}
      <FailureNotice
        failure={archivedFailure}
        title="The Archived Templates Could Not Be Read"
        fallback="The archived templates could not be read. The active catalogue is still shown."
        whenSilent="Nothing answered when the archived templates were asked for."
        onRetry={() => void archivedRead.refetch()}
      />
    {/if}

    <DataTable.Grid
      grid={ownGrid}
      class="min-h-0 flex-1"
      {caption}
      cell={templateCell}
      {rowDetail}
      loading={rows === null}
    >
    </DataTable.Grid>

    <!-- The counts strip: how much of the catalogue is on screen, the way to the rest of it, and
         the one control that WIDENS the list. One line at a fixed height, so it never reflows. -->
    <DataTable.GridFooter grid={ownGrid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="templates"
          more={activeRead.hasNextPage}
          loading={activeRead.isFetchingNextPage}
          onLoad={() => void activeRead.fetchNextPage()}
        />
        {#if showArchived}
          <DataTable.LoadMore
            noun="archived templates"
            more={archivedRead.hasNextPage}
            loading={archivedRead.isFetchingNextPage}
            onLoad={() => void archivedRead.fetchNextPage()}
          />
        {/if}
        {#if rows !== null}
          <!-- Undone by its own label, never by the clear control: a control that says "Show
               Everything" because MORE is on screen answers the wrong question. Absent while the
               list has not settled, so nothing offers to widen a list that is not there yet. -->
          <Button
            variant="ghost"
            size="sm"
            class={showArchived ? "text-accent-default" : "text-text-muted"}
            title={showArchived
              ? "Leave the archived templates out of the list"
              : "Add the templates withdrawn from the catalogue to the list"}
            onclick={() => (showArchived = !showArchived)}
          >
            {showArchived ? "Hide Archived" : "Show Archived"}
          </Button>
        {/if}
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>
