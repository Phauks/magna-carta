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
   * IT CREATES, AND ASKS WHICH MATTER. This screen shipped read-only on the reasoning that a create
   * control would have to ask which matter first and would therefore be the matter's own screen in
   * disguise. The Conflicts Check ruling settled the same question the other way a day later: where
   * a surface HOLDS a record and OFFERS the act that writes one, the record is the screen and the
   * act is the create control over it — the firm-wide log asks which matter in its panel and the
   * matter's own section does not, and both open the same one. A register of corpora with no way to
   * start a corpus is a reader for somebody else's data.
   *
   * WHAT STAYS TRUE is the reason the old comment gave: a corpus with no matter is not a thing this
   * model has. The matter is asked for in the panel, once, because it decides the ceiling the set
   * snapshots and the lifecycle it lives under — not routed around by sending the reader elsewhere.
   *
   * IT IS ONE TABLE AT THE FULL WIDTH. The matter is a column with its own filter, narrowed the way
   * the state is; there is no rail and no tab strip, because everything this register could be
   * narrowed by is a property of a row.
   *
   * AND IT SEARCHES THE WAY EVERY OTHER LIST SCREEN DOES — ScreenSearch in the action row, which is
   * the product's one control for searching within the screen you are on. A reviewer holding four
   * corpora finds one by typing its name, with the same gesture the custody register and the docket
   * take.
   *
   * THE MATCH IS THE SERVER'S, over the whole register rather than the page in hand: the listing is
   * cursor-paged, so a narrowing of the rows already fetched would answer confidently about the
   * first page and read as the whole record. It matches the review set's NAME and not its matter —
   * the register names the matter on every row, but a member on a review set's access list may hold
   * no access to that matter at all, so matching a matter's title would make a corpus findable by a
   * fact its reader is not entitled to.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { goto } from "$app/navigation";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { resolveMatterRecord } from "$lib/matters/matter-record.ts";
  import NewReviewSetDialog from "$lib/discovery/new-review-set-dialog.svelte";
  import ReviewSetList from "$lib/discovery/review-set-list.svelte";
  import {
    MANAGE_REVIEW_SETS_PERMISSION,
    type ReviewSet,
  } from "$lib/discovery/discovery-api.ts";

  let grid = $state<DataTable.DataTableGridState<ReviewSet> | null>(null);
  let matterTitles = $state<ReadonlyMap<string, string>>(new Map());
  let session = $state<SessionBootstrap | null>(null);
  let composerOpen = $state(false);
  let rereadRegister = $state<() => void>(() => {});
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  /*
   * Why the control cannot be pressed, or undefined while it can. It never leaves the row: a
   * control that vanished would tell a reader nothing about why, and a member refused server-side
   * should learn that here rather than at the commit.
   */
  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!session.permissions.includes(MANAGE_REVIEW_SETS_PERMISSION)) {
      return permissionRefusal("Creating a review set", MANAGE_REVIEW_SETS_PERMISSION);
    }
    return undefined;
  });

  /*
   * A corpus that has just been made goes straight to itself — the next thing anybody does with one
   * is put material in it — and the register behind is read again so the row is there on the way
   * back.
   */
  function onCreated(reviewSetId: string): void {
    rereadRegister();
    void goto(`/discovery/review-sets/${reviewSetId}`);
  }

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

  /*
   * The field's own text, and the term the listing is actually on.
   *
   * They are two states rather than one because the search leaves the machine: `searchOn="pause"`
   * hands over the query once typing settles, and the read runs on THAT — so the field keeps up with
   * the keys while the register re-reads once per thought rather than once per keystroke.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  const searching = $derived(appliedSearch.trim() !== "");
  const narrowed = $derived((grid?.activeFilterCount ?? 0) > 0 || searching);

  function showEverything(): void {
    searchText = "";
    appliedSearch = "";
    grid?.clearAllFilters();
  }
</script>

<svelte:head><title>Discovery · Magna Carta</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Discovery">
    {#snippet actions()}
      <!-- The search, then the way back to the whole register. The query leaves the machine, so it
           waits for typing to stop: one request per thought rather than one per keystroke. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the review sets"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />

      <CreateControl
        title="Start a review set on one of your matters."
        refusal={createRefusal}
        onpress={() => (composerOpen = true)}
      />

      <DataTable.ClearFilters
        grid={grid ?? undefined}
        narrowing={{
          narrowed,
          summary: "Show every review set",
          clear: showEverything,
        }}
      />
    {/snippet}
  </ScreenHeader>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    <ReviewSetList
      {matterTitles}
      search={appliedSearch}
      bind:grid
      bind:reread={rereadRegister}
      onOpen={(reviewSetId) => void goto(`/discovery/review-sets/${reviewSetId}`)}
      onRows={(rows) => void nameMatters(rows)}
      caption="All review sets you can access"
      emptyTitle="Nothing Is Open To You Yet"
    >
      {#snippet emptyBody()}
        No review sets are shared with you. Start one with New, or from a matter's Discovery section.
      {/snippet}
    </ReviewSetList>
  </div>
</div>

<NewReviewSetDialog bind:open={composerOpen} chooseMatter {onCreated} />
