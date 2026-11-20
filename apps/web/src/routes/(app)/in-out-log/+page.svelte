<script lang="ts">
  /*
   * The In/Out Log: what crosses the front desk that is not held in custody. Copies, papers, a
   * physical file handed back. Each thing is a numbered entry, To one or more people, and it stays
   * on Waiting for Pickup until somebody picks it up or it is moved into Custodian.
   *
   * Two tabs, as the owner picked from the mockups on 2026-11-19: Waiting for Pickup is the desk's
   * work list, oldest first; Log is everything, newest first. Pick Up sits on each waiting row, so
   * there is no separate pick-up control above the table.
   */
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import ScreenSearch from "@magna-carta/design-system/screen-search";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import Inbox from "@lucide/svelte/icons/inbox";
  import HandHelping from "@lucide/svelte/icons/hand-helping";
  import IdCard from "@lucide/svelte/icons/id-card";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { permissionRefusal } from "$lib/access/refusal.ts";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import { listFirmMembers, type FirmMemberSummary } from "$lib/members/members-api.ts";
  import { AnchorMatters } from "$lib/communications/anchor-matters.svelte.ts";
  import {
    listCustodyLocations,
    type CreatedCustodyPacket,
    type CustodyLocationNode,
  } from "$lib/custodian/custody-api.ts";
  import NewPacketDialog from "$lib/custodian/new-packet-dialog.svelte";
  import {
    deleteInOutEntry,
    identityScanHref,
    linkToCustodyPacket,
    listInOutEntries,
    MANAGE_IN_OUT_LOG_PERMISSION,
    type InOutEntry,
  } from "$lib/in-out-log/in-out-log-api.ts";
  import {
    ENTRY_COLUMN,
    entryColumns,
    initialSort,
    outcomeText,
    STATUS_LABEL,
  } from "$lib/in-out-log/entry-columns.ts";
  import DropOffDialog from "$lib/in-out-log/drop-off-dialog.svelte";
  import PickUpDialog from "$lib/in-out-log/pick-up-dialog.svelte";

  // ---- who is asking, and the lists the windows choose from -----------------------------------

  let session = $state<SessionBootstrap | null>(null);
  let members = $state<readonly FirmMemberSummary[]>([]);
  let locations = $state<readonly CustodyLocationNode[]>([]);
  const matters = new AnchorMatters();
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const outcome = await readSession(fetch);
      if (outcome.kind === "ok") session = outcome.value;
    })();
    void (async () => {
      const outcome = await listFirmMembers(fetch);
      if (outcome.kind === "ok") members = outcome.value.data;
    })();
    void matters.load(fetch);
  });

  const mayManage = $derived(session?.permissions.includes(MANAGE_IN_OUT_LOG_PERMISSION) ?? false);
  const mayUseCustodian = $derived(session?.permissions.includes("custody:manage") ?? false);
  const manageRefusal = $derived.by((): string | undefined => {
    if (session === null) return "Reading your session.";
    if (!mayManage) return permissionRefusal("Using the In/Out Log", "inOutLog:manage");
    return undefined;
  });

  // ---- the two tabs and the search ------------------------------------------------------------

  let view = $state<"waiting" | "all">("waiting");
  let searchText = $state("");
  let appliedSearch = $state("");
  const list = new PagedList<InOutEntry>("The In/Out Log could not be read.");
  const subject = $derived(`${view}|${appliedSearch.trim()}`);

  function read(cursor?: string) {
    return listInOutEntries(fetch, { status: view, search: appliedSearch, cursor });
  }

  $effect(() => {
    const asked = subject;
    if (list.showing(asked)) return;
    list.reset(asked);
    void list.load(read);
  });

  /* How many are waiting, for the tab's count. One page is the most it says; past it, "50+". */
  let waitingCount = $state<string | null>(null);
  async function readWaitingCount(): Promise<void> {
    const outcome = await listInOutEntries(fetch, { status: "waiting" });
    if (outcome.kind !== "ok") return;
    const count = outcome.value.data.length;
    waitingCount = outcome.value.nextCursor === null ? String(count) : `${count}+`;
  }
  $effect(() => {
    void readWaitingCount();
  });

  function reread(): void {
    list.reset(subject);
    void list.load(read);
    void readWaitingCount();
  }

  /*
   * One grid per tab, because the two differ in their columns (the Log adds Status) and in their
   * order (the waiting list oldest first, the Log newest first).
   */
  function gridFor(tab: "waiting" | "all") {
    return DataTable.createDataTableGrid<InOutEntry>({
      columns: () => entryColumns(tab),
      rows: () => list.items ?? [],
      rowKey: (entry) => entry.id,
      initialSort: initialSort(tab),
      itemNoun: { singular: "entry", plural: "entries" },
    });
  }
  const waitingGrid = gridFor("waiting");
  const logGrid = gridFor("all");
  const grid = $derived(view === "waiting" ? waitingGrid : logGrid);

  // ---- the windows ----------------------------------------------------------------------------

  let dropOffOpen = $state(false);
  let pickUpOpen = $state(false);
  let deleteOpen = $state(false);
  let custodianOpen = $state(false);
  let acting = $state<InOutEntry | null>(null);
  let notice = $state<string | null>(null);
  let actionFailure = $state<StatedFailure | null>(null);

  function startPickUp(entry: InOutEntry): void {
    acting = entry;
    pickUpOpen = true;
  }

  function startDelete(entry: InOutEntry): void {
    acting = entry;
    deleteOpen = true;
  }

  async function startMoveToCustodian(entry: InOutEntry): Promise<void> {
    acting = entry;
    if (locations.length === 0) {
      const tree = await listCustodyLocations(fetch);
      if (tree.kind === "ok") locations = tree.value.data;
    }
    custodianOpen = true;
  }

  /*
   * Whom the packet is held for, to start with: the Directory people on the entry, the person it
   * came from first. A typed name or a member cannot own a packet, so they are left for the window.
   */
  const custodianPrefill = $derived.by(() => {
    if (acting === null) return null;
    const owners = [acting.from, ...acting.to]
      .filter((party) => party.kind === "entity" && party.entityId !== null)
      .map((party) => ({ entityId: party.entityId ?? "", displayName: party.name }));
    const unique = owners.filter(
      (owner, index) => owners.findIndex((other) => other.entityId === owner.entityId) === index,
    );
    return {
      name: acting.description,
      owners: unique,
      notes: `From In/Out Log ${acting.number}.`,
    };
  });

  async function onPacketLogged(created: CreatedCustodyPacket): Promise<void> {
    const entry = acting;
    if (entry === null) return;
    actionFailure = null;
    const outcome = await linkToCustodyPacket(fetch, entry.id, created.id, crypto.randomUUID());
    if (outcome.kind === "ok") {
      notice = `${entry.number} moved to Custodian as ${created.custodyNumber}.`;
    } else {
      actionFailure = stated(
        outcome.failure,
        `Packet ${created.custodyNumber} was logged, but ${entry.number} could not be marked as moved.`,
      );
    }
    reread();
  }

  async function removeEntry(): Promise<ActionOutcome> {
    const entry = acting;
    if (entry === null) return "refused";
    const outcome = await deleteInOutEntry(fetch, entry.id, crypto.randomUUID());
    if (outcome.kind === "ok") {
      notice = `${entry.number} was deleted.`;
      reread();
      return "committed";
    }
    actionFailure = stated(outcome.failure, `${entry.number} could not be deleted.`);
    return "refused";
  }
</script>

<svelte:head><title>In/Out Log · Magna Carta</title></svelte:head>

{#snippet entryCell({ row, column, text }: DataTable.GridCellContext<InOutEntry>)}
  {#if column.id === ENTRY_COLUMN.number}
    <span class="tabular-nums">{text}</span>
  {:else if column.id === ENTRY_COLUMN.item}
    <div class="flex min-w-0 flex-col">
      <span class="font-semibold">{row.description}</span>
      <span class="text-text-muted">From {row.from.name}{row.keptAt === null ? "" : `, ${row.keptAt}`}</span>
    </div>
  {:else if column.id === ENTRY_COLUMN.to}
    <div class="flex flex-col">
      {#each row.to as person (person.id)}
        <span>{person.name}</span>
      {/each}
    </div>
  {:else if column.id === ENTRY_COLUMN.matter}
    {#if row.matter === null}
      <span class="text-text-muted">No matter</span>
    {:else}
      <div class="flex min-w-0 flex-col">
        <a class="underline-offset-2 hover:underline" href="/matters/{row.matter.id}">{row.matter.title}</a>
        {#if row.matter.number !== null}
          <span class="text-text-muted tabular-nums">{row.matter.number}</span>
        {/if}
      </div>
    {/if}
  {:else if column.id === ENTRY_COLUMN.status}
    <div class="flex flex-col">
      <span>{STATUS_LABEL[row.status]}</span>
      <span class="text-text-muted">{outcomeText(row)}</span>
    </div>
  {:else if column.id === ENTRY_COLUMN.actions}
    {#if row.status === "waiting" && manageRefusal === undefined}
      <div class="flex items-center justify-end gap-8">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Pick Up {row.number}"
          onclick={(event: MouseEvent) => {
            event.stopPropagation();
            startPickUp(row);
          }}
        >
          <HandHelping class="size-16" aria-hidden="true" />
          <!-- The words go on a phone, where the action column would otherwise take the row. -->
          <span class="hidden sm:inline">Pick Up</span>
        </Button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger
            class={buttonClasses({ variant: "ghost", size: "sm" })}
            aria-label="More for {row.number}"
          >
            <Ellipsis class="size-16" aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Content>
            <DropdownMenu.Item
              disabled={!mayUseCustodian}
              onSelect={() => void startMoveToCustodian(row)}
            >
              Move to Custodian
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => startDelete(row)}>Delete</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </div>
    {:else if row.pickedUp?.identityScanned === true && manageRefusal === undefined}
      <!-- The picture opens on its own, because every view of somebody's ID is recorded. -->
      <div class="flex items-center justify-end">
        <Button
          variant="ghost"
          size="sm"
          href={identityScanHref(row.id)}
          {...opensBeside("file")}
          aria-label="View ID for {row.number}"
        >
          <IdCard class="size-16" aria-hidden="true" />
          <span class="hidden sm:inline">View ID</span>
        </Button>
      </div>
    {/if}
  {:else}
    {text}
  {/if}
{/snippet}

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader title="In/Out Log">
    {#snippet actions()}
      <ScreenSearch
        bind:value={searchText}
        label="Search the log"
        searchOn="pause"
        fieldClass="w-2xs sm:w-xs"
        onsearch={(next) => {
          appliedSearch = next;
        }}
      />
      <Button
        disabled={manageRefusal !== undefined}
        title={manageRefusal ?? "Record something left at the desk."}
        onclick={() => (dropOffOpen = true)}
      >
        <Inbox class="size-16" aria-hidden="true" />
        Drop Off
      </Button>
    {/snippet}
  </ScreenHeader>

  {#if notice !== null}
    <Alert.Root variant="success">
      <Alert.Description>{notice}</Alert.Description>
    </Alert.Root>
  {/if}
  {#if actionFailure !== null}
    <FailureNotice
      failure={actionFailure.failure}
      title="Something Did Not Save"
      fallback={actionFailure.fallback}
      whenSilent={actionFailure.whenSilent}
    />
  {/if}

  <Tabs.Root bind:value={view}>
    <Tabs.List>
      <Tabs.Trigger value="waiting">
        <span class="flex items-center gap-8">
          Waiting for Pickup
          {#if waitingCount !== null}
            <span class="text-text-muted tabular-nums">{waitingCount}</span>
          {/if}
        </span>
      </Tabs.Trigger>
      <Tabs.Trigger value="all">Log</Tabs.Trigger>
    </Tabs.List>
  </Tabs.Root>

  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-16">
    {#if list.failure !== null}
      <FailureNotice
        failure={list.failure}
        title="The In/Out Log Could Not Be Read"
        fallback={list.failureMessage ?? undefined}
        onRetry={reread}
      />
    {:else}
      {#key view}
        <DataTable.Grid
          {grid}
          class="min-h-0 flex-1"
          caption={view === "waiting" ? "Waiting for pickup" : "The In/Out Log"}
          cell={entryCell}
          loading={list.items === null}
        />
      {/key}
      <DataTable.GridFooter {grid}>
        {#snippet end()}
          <DataTable.LoadMore
            noun="entries"
            more={list.nextCursor !== null}
            loading={list.loadingMore}
            onLoad={() => void list.loadMore(read)}
          />
        {/snippet}
      </DataTable.GridFooter>
    {/if}
  </div>
</div>

<DropOffDialog
  bind:open={dropOffOpen}
  {members}
  matters={matters.matters ?? []}
  mattersCapped={matters.capped}
  onDroppedOff={(created) => {
    notice = `Dropped off as ${created.number}.`;
    reread();
  }}
/>

<PickUpDialog
  bind:open={pickUpOpen}
  entry={acting}
  {members}
  onPickedUp={() => {
    notice = acting === null ? null : `${acting.number} was picked up.`;
    reread();
  }}
/>

<ActionDialog
  bind:open={deleteOpen}
  kind="destructive"
  heading="Delete Entry"
  subtitle={acting === null ? undefined : { reference: { kind: "", number: acting.number } }}
  commitLabel="Delete"
  commitBusyLabel="Deleting"
  unsavedChanges={false}
  onOpen={() => (actionFailure = null)}
  onCommit={removeEntry}
>
  {#snippet fields()}
    <p class="text-sm">
      Delete this entry if it was recorded by mistake. Its number is not used again.
    </p>
  {/snippet}
</ActionDialog>

<NewPacketDialog
  bind:open={custodianOpen}
  heading="Move to Custodian"
  {locations}
  matterId={acting?.matter?.id ?? null}
  prefill={custodianPrefill}
  onCreated={(created) => void onPacketLogged(created)}
  onLocationsAdded={(added) => (locations = [...locations, ...added])}
/>
