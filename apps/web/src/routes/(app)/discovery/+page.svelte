<script lang="ts">
  /*
   * Discovery — every review set this member may reach, across every matter.
   *
   * WHY THIS IS A TOP-LEVEL SCREEN AND NOT ONLY A MATTER SECTION. The wall around a corpus is the
   * per-review-set access list, NOT matter access — that is the whole point of a list that answers
   * 404 rather than 403. So a reviewer brought in for one production is on that review set's list
   * and may hold no access at all to the matter it belongs to. Reached only through matters, their
   * own work would be invisible to them. This register is the one screen scoped the way the wall
   * is.
   *
   * IT READS AND OPENS; IT DOES NOT CREATE. A review set is created from the matter it belongs to,
   * because that is where its ceiling, its lifecycle and its first access-list entry are decided,
   * and a corpus with no matter is not a thing this model has. A create control here would have to
   * ask which matter first, which is the matter's own screen wearing a disguise.
   *
   * IT IS ONE TABLE AT THE FULL WIDTH. The matter is a column with its own filter, narrowed the way
   * the state is; there is no rail and no tab strip, because everything this register could be
   * narrowed by is a property of a row.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { goto } from "$app/navigation";
  import { resolveMatterRecord } from "$lib/matters/matter-record.ts";
  import ReviewSetList from "$lib/discovery/review-set-list.svelte";
  import type { ReviewSet } from "$lib/discovery/discovery-api.ts";

  let grid = $state<DataTable.DataTableGridState<ReviewSet> | null>(null);
  let matterTitles = $state<ReadonlyMap<string, string>>(new Map());

  /*
   * The matters the rows on screen belong to, resolved one at a time and cached.
   *
   * ONE READ PER MATTER, NOT PER ROW, and only for matters actually on screen — a member's review
   * sets are few, and reading the whole docket to name three of them would be a large read whose
   * later pages would leave a matter looking unnameable when it is merely unfetched.
   *
   * A matter this member cannot open resolves to nothing and stays out of the map, and the column
   * then says so in words rather than printing an identifier. That is the design working: a
   * reviewer cleared for one production genuinely may not be able to see the case it belongs to.
   */
  const asked = new Set<string>();
  async function nameMatters(rows: readonly ReviewSet[]): Promise<void> {
    const wanted = [...new Set(rows.map((row) => row.matterId))].filter((id) => !asked.has(id));
    if (wanted.length === 0) return;
    for (const id of wanted) asked.add(id);
    const resolved = await Promise.all(
      wanted.map(async (id) => [id, (await resolveMatterRecord(fetch, id))?.title] as const),
    );
    const next = new Map(matterTitles);
    for (const [id, title] of resolved) {
      if (title !== undefined) next.set(id, title);
    }
    matterTitles = next;
  }

  const narrowed = $derived((grid?.activeFilterCount ?? 0) > 0);
</script>

<svelte:head><title>Discovery · Magna Carta</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Discovery">
    {#snippet actions()}
      <DataTable.ClearFilters
        grid={grid ?? undefined}
        narrowing={{
          narrowed,
          summary: "Show every review set",
          clear: () => grid?.clearAllFilters(),
        }}
      />
    {/snippet}
  </ScreenHeader>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    <ReviewSetList
      {matterTitles}
      bind:grid
      onOpen={(reviewSetId) => void goto(`/discovery/review-sets/${reviewSetId}`)}
      onRows={(rows) => void nameMatters(rows)}
      caption="Every review set you can reach"
      emptyTitle="Nothing Is Open To You Yet"
    >
      {#snippet emptyBody()}
        A review set is a corpus under review — a production another party served, or the firm's own
        collection — and you see one only once somebody has put you on its list. A review set is
        started from the matter it belongs to, under that matter's Discovery section.
      {/snippet}
    </ReviewSetList>
  </div>
</div>
