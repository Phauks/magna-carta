<script lang="ts">
  /*
   * Custodian — the firm's holdings of record.
   *
   * WHY THIS IS A TOP-LEVEL SCREEN AND NOT ONLY A MATTER TAB. The question this register answers is
   * "where is the original will", and that question does not arrive through a matter. A firm holds
   * a will for a client whose last matter closed eleven years ago, for the adult child of a client,
   * for a deceased client's estate, for somebody who has never had a matter at all. A packet's
   * matter link is optional by construction, so the register has to be reachable without one.
   *
   * IT IS ONE TABLE, AND THE TABLE IS WHAT NARROWS IT. There is no status control above the rows,
   * no search box of its own and no tab strip: status is a column with its own filter, search is
   * the app's, and what used to be the By Owner, Holds and Due tabs were three screens standing
   * beside a register that answers the same questions. Two mechanisms narrowing one list is how
   * somebody ends up staring at an almost-empty table with a filter set on a control they are not
   * looking at (docs/conventions/design-corrections.md, the matters docket round).
   *
   * The grid is bound out of the listing for the clear-filters control alone. Column show/hide,
   * pinning and the per-column filters are summoned from a column's own header, which is the one
   * home for them; no surface carries a columns button.
   *
   * THE CONTAINER TREE IS GONE, AND LOCATION IS A COLUMN LIKE ANY OTHER (owner's ruling,
   * 2026-09-06). It was kept as the one narrowing that is not a second filter — it read a whole
   * BRANCH, a subtree the server resolves per request, which a column filter over loaded rows
   * cannot express — and that argument did not survive contact with the screen: a rail down the
   * left made this register read as a different kind of table from every other one in the product,
   * and it did not earn the difference. Location is a set-filtered column (packet-columns.ts),
   * narrowed the way Status is, and the register runs the full width the way every other listing
   * does. The server's subtree read stays in the API for whatever asks for it next; nothing on
   * this screen does.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import * as Alert from "@magna-carta/design-system/alert";
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import {
    listCustodyLocations,
    MANAGE_CUSTODY_PERMISSION,
    type CreatedCustodyPacket,
    type CustodyLocationNode,
    type CustodyPacketSummary,
  } from "$lib/custodian/custody-api.ts";
  import NewPacketDialog from "$lib/custodian/new-packet-dialog.svelte";
  import PacketRegister from "$lib/custodian/packet-register.svelte";
  import PacketWindow from "$lib/custodian/packet-window.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  // ---- the firm's own containers, read for their NAMES --------------------------------------------
  //
  // The register stores a location handle per packet; this read is what turns it into the shelf a
  // person would say out loud, and what fills the New Packet dialog's location field. It is not a
  // navigation of its own any more.

  let locations = $state<readonly CustodyLocationNode[]>([]);
  let treeFailure = $state<StatedFailure | null>(null);
  let session = $state<SessionBootstrap | null>(null);
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void readTree();
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
  });

  async function readTree(): Promise<void> {
    const tree = await listCustodyLocations(fetch);
    if (tree.kind === "ok") locations = tree.value.data;
    // Containers that cannot be read leave the register readable: the packets and their numbers
    // are still true, and only the Location column goes quiet.
    treeFailure =
      tree.kind === "ok"
        ? null
        : stated(tree.failure, "The firm's custody locations could not be read.");
  }

  // ---- who is asking, and what they may do ------------------------------------------------------

  const mayManage = $derived(session?.permissions.includes(MANAGE_CUSTODY_PERMISSION) ?? false);
  /*
   * The two honest refusals, in the order a person meets them. A member without the permission is
   * refused server-side whatever this screen does; a firm with no open container has nowhere to put
   * a packet, and a form that opened anyway would end at a location field with nothing in it.
   */
  const createRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayManage) {
      return permissionRefusal("Logging a packet", "custody:manage");
    }
    if (locations.length > 0 && !locations.some((location) => location.status === "active")) {
      return "A packet is logged into a container, and the firm has no open one to put it in.";
    }
    return undefined;
  });

  // ---- the register ----------------------------------------------------------------------------

  let openPacketId = $state<string | null>(null);
  let windowOpen = $state(false);
  let dialogOpen = $state(false);
  let lastLogged = $state<CreatedCustodyPacket | null>(null);
  let grid = $state<DataTable.DataTableGridState<CustodyPacketSummary> | null>(null);
  let rereadRegister = $state<() => void>(() => {});

  /*
   * The search is the register's own server-side `search`, so it reads the whole register rather
   * than the page in the browser; it waits for typing to pause because the read leaves the
   * machine. It sits beside the create control in the masthead, the pair every list screen
   * carries in the same order.
   */
  let searchText = $state("");
  let appliedSearch = $state("");

  const query = $derived(
    appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() },
  );

  const narrowed = $derived(appliedSearch.trim() !== "" || (grid?.activeFilterCount ?? 0) > 0);
  const narrowingSummary = $derived(
    appliedSearch.trim() === ""
      ? "Show every packet"
      : `Showing "${appliedSearch.trim()}" of the register`,
  );

  function clearNarrowing(): void {
    searchText = "";
    appliedSearch = "";
    grid?.clearAllFilters();
  }

  // Every door into a packet opens the same window: one reached through the tree's branch is the
  // same record as one reached from the whole register, and meeting two different windows for it
  // would be two things a reader has to learn.
  function openPacket(packetId: string): void {
    openPacketId = packetId;
    windowOpen = true;
  }

  /*
   * A logged packet adds a row to the register, and may be the first packet in a container the
   * names read has not seen — a container opened in another tab while this screen sat here. Both
   * are read again, so the new row can print the shelf it went onto rather than an empty cell.
   */
  function onLogged(created: CreatedCustodyPacket): void {
    lastLogged = created;
    rereadRegister();
    void readTree();
  }
</script>

<svelte:head><title>Custodian · Magna Carta</title></svelte:head>

<div class="flex h-full flex-col gap-16">
  <ScreenHeader title="Custodian">
    {#snippet actions()}
      <!-- The search, then the create control: the search grows toward the inline start, so the
           control at the row's end never moves when it opens. The same pair, in the same order, as
           the matter header. -->
      <ScreenSearch
        bind:value={searchText}
        label="Search the register"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <CreateControl
        noun="Packet"
        title="Log a packet into custody."
        refusal={createRefusal}
        onpress={() => (dialogOpen = true)}
      />

      <DataTable.ClearFilters
        grid={grid ?? undefined}
        narrowing={{ narrowed, summary: narrowingSummary, clear: clearNarrowing }}
      />
    {/snippet}
  </ScreenHeader>

  {#if lastLogged !== null}
    <!-- The number the register drew, which is what somebody writes on the physical label. It
         opens the packet, because the next thing anyone does with a new packet is describe it. -->
    <Alert.Root variant="success">
      <Alert.Title>The Packet Is Logged</Alert.Title>
      <Alert.Description>
        {@const logged = lastLogged}
        <button
          class="underline underline-offset-2 tabular-nums"
          type="button"
          onclick={() => openPacket(logged.id)}
        >
          {logged.custodyNumber}
        </button>
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if treeFailure !== null}
    <FailureNotice
      failure={treeFailure.failure}
      title="The Custody Locations Could Not Be Read"
      fallback={treeFailure.fallback}
      whenSilent={treeFailure.whenSilent}
      onRetry={() => void readTree()}
    />
  {/if}

  <!-- One table, the full width of the screen — the arrangement every other list screen uses.
       Where a packet is kept is the Location column's business, narrowed from its own header the
       way Status is. -->
  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    <PacketRegister
      {query}
      {locations}
      bind:grid
      bind:reread={rereadRegister}
      onOpenPacket={openPacket}
      caption="The firm's custody register"
      emptyTitle="Nothing Is In Custody Yet"
    >
      {#snippet emptyBody()}
        A packet is the physical thing the firm holds and moves: an envelope, a deed box, a sealed
        wallet. It carries a custody number, the person or organization it is held for, and
        everything that has ever happened to it. Logging the first one, with New Packet at the top
        of the screen, draws the firm's first custody number.
      {/snippet}
    </PacketRegister>
  </div>
</div>

<NewPacketDialog bind:open={dialogOpen} {locations} onCreated={onLogged} />

<PacketWindow
  bind:open={windowOpen}
  packetId={openPacketId}
  {locations}
  mayManage={createRefusal === undefined}
/>
