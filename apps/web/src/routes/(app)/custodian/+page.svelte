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
   * The screen composes the List archetype with a filter rail: the container tree on the left, the
   * register on the right, and the reports a firm actually asks for as their own panels beside them.
   * Selecting a node in the tree narrows the register to that whole branch — boxes and positions
   * inside it included — which is the read the server does once per request rather than per row.
   *
   * WHAT IS NOT HERE, AND IS SAID RATHER THAN HIDDEN. Logging a packet, recording a movement,
   * placing a hold and raising a destruction request are all served by the register today and have
   * no form behind them yet. Each control renders with its real words, disabled, saying what it
   * waits on — a reader can see the shape of what is coming and can never mistake it for working.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import * as Select from "@magna-carta/design-system/select";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Plus from "@lucide/svelte/icons/plus";
  import X from "@lucide/svelte/icons/x";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import {
    listCustodyLocations,
    readCustodyLocationOccupancy,
    type CustodyLocationNode,
    type CustodyLocationOccupancy,
  } from "$lib/custodian/custody-api.ts";
  import { PACKET_STATUSES, packetStatusEntry } from "$lib/custodian/custody-vocabulary.ts";
  import HoldingsByOwner from "$lib/custodian/holdings-by-owner.svelte";
  import HoldsInForce from "$lib/custodian/holds-in-force.svelte";
  import LocationTree from "$lib/custodian/location-tree.svelte";
  import OverdueCheckouts from "$lib/custodian/overdue-checkouts.svelte";
  import PacketRegister from "$lib/custodian/packet-register.svelte";
  import PacketWindow from "$lib/custodian/packet-window.svelte";
  import RemindersDue from "$lib/custodian/reminders-due.svelte";

  /** What logging a packet from this screen waits on. */
  const PACKET_FORM =
    "the packet form, which names at least one owner from the directory before a packet can be logged at all";

  // ---- the firm's own container tree -----------------------------------------------------------

  let locations = $state<readonly CustodyLocationNode[]>([]);
  let occupancy = $state<readonly CustodyLocationOccupancy[]>([]);
  let treeFailure = $state<string | null>(null);
  let bootstrapped = false;

  $effect(() => {
    if (bootstrapped) return;
    bootstrapped = true;
    void (async () => {
      const [tree, counts] = await Promise.all([
        listCustodyLocations(fetch),
        readCustodyLocationOccupancy(fetch),
      ]);
      if (tree.kind === "ok") locations = tree.value.data;
      if (counts.kind === "ok") occupancy = counts.value.data;
      // A tree that cannot be read leaves the register readable: the packets and their numbers are
      // still true, and only the Location column and the branch filter go quiet.
      if (tree.kind !== "ok") {
        treeFailure =
          tree.kind === "transport"
            ? "Nothing answered. The firm's custody locations could not be read."
            : (tree.problem.detail ?? "The firm's custody locations could not be read.");
      }
    })();
  });

  // ---- what the register is being asked ---------------------------------------------------------

  /*
   * "Every standing" carries a real value rather than an empty string. An empty value reads to the
   * select as "nothing chosen", so the trigger would sit blank on arrival and a reader would not be
   * able to tell an unfiltered register from a control that had failed to load.
   */
  const EVERY_STANDING = "every";

  const STATUS_ITEMS = [
    { value: EVERY_STANDING, label: "Every standing" },
    ...PACKET_STATUSES.map((status) => ({
      value: status,
      label: packetStatusEntry(status).label,
    })),
  ];

  let statusChoice = $state<string>(EVERY_STANDING);
  let searchText = $state("");
  let appliedSearch = $state("");
  let selectedLocationId = $state<string | undefined>(undefined);
  let openPacketId = $state<string | null>(null);
  let windowOpen = $state(false);

  // The typed query settles before it is sent: a register read per keystroke is a request per
  // keystroke, and the server's search is the authoritative one over the packet's name and number.
  $effect(() => {
    const typed = searchText;
    const timer = setTimeout(() => (appliedSearch = typed), 300);
    return () => clearTimeout(timer);
  });

  const query = $derived({
    ...(statusChoice === EVERY_STANDING
      ? {}
      : { status: statusChoice as (typeof PACKET_STATUSES)[number] }),
    ...(appliedSearch.trim() === "" ? {} : { search: appliedSearch.trim() }),
    ...(selectedLocationId === undefined ? {} : { locationSubtreeId: selectedLocationId }),
  });

  const selectedLocationName = $derived(
    occupancy.find((node) => node.locationId === selectedLocationId)?.name ?? null,
  );

  // Every panel on this screen opens the same window: a packet reached from the overdue list is
  // the same record as one reached from the register, and meeting two different windows for it
  // would be two things a reader has to learn.
  function openPacket(packetId: string): void {
    openPacketId = packetId;
    windowOpen = true;
  }
</script>

<svelte:head><title>Custodian · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Custodian</Masthead.Title>
    <Masthead.Meta>
      <span>Originals the firm holds in safekeeping</span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <SoonAffordance reason={PACKET_FORM}>
      {#snippet control(soon)}
        <Button variant="primary" {...soon}>
          <Plus class="size-16" aria-hidden="true" />
          Log a packet
        </Button>
      {/snippet}
    </SoonAffordance>
  </Masthead.Actions>
</Masthead.Root>

<Tabs.Root value="register">
  <Tabs.List>
    <Tabs.Trigger value="register">Register</Tabs.Trigger>
    <Tabs.Trigger value="owners">By Owner</Tabs.Trigger>
    <Tabs.Trigger value="holds">Holds</Tabs.Trigger>
    <Tabs.Trigger value="due">Due</Tabs.Trigger>
  </Tabs.List>

  <Tabs.Content value="register" class="min-w-0">
    <div class="grid gap-24 lg:grid-cols-4">
      <div class="flex flex-col gap-12 lg:col-span-1">
        <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
          Where things are
        </h2>
        {#if treeFailure !== null}
          <Alert.Root variant="warning">
            <Alert.Title>The Custody Locations Could Not Be Read</Alert.Title>
            <Alert.Description>{treeFailure}</Alert.Description>
          </Alert.Root>
        {:else if occupancy.length === 0}
          <p class="text-xs text-text-muted">
            No container has been described yet. A custody tree is offices, safes, cabinets, shelves
            and boxes, plus the bank vaults and offsite stores that are not the firm's own offices.
          </p>
        {:else}
          <LocationTree {occupancy} bind:selectedId={selectedLocationId} />
        {/if}
      </div>

      <div class="flex min-w-0 flex-col gap-16 lg:col-span-3">
        <div class="flex flex-wrap items-end gap-16">
          <div class="flex flex-col gap-8">
            <Label for="custody-search">Search</Label>
            <Input
              id="custody-search"
              type="search"
              placeholder="Search"
              bind:value={searchText}
              aria-describedby="custody-search-hint"
            />
            <p id="custody-search-hint" class="text-xs text-text-muted">
              Over the packet's name and its custody number, run by the register rather than over the
              rows on screen.
            </p>
          </div>
          <div class="flex flex-col gap-8">
            <Label id="custody-status-label">Standing</Label>
            <Select.Root
              type="single"
              items={STATUS_ITEMS}
              bind:value={statusChoice}
              allowDeselect={false}
            >
              <Select.Trigger class="min-w-64" aria-labelledby="custody-status-label">
                <Select.Value />
              </Select.Trigger>
              <Select.Content>
                {#each STATUS_ITEMS as item (item.value)}
                  <Select.Item value={item.value} label={item.label} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
          {#if selectedLocationId !== undefined}
            <Button variant="secondary" onclick={() => (selectedLocationId = undefined)}>
              <X class="size-16" aria-hidden="true" />
              {selectedLocationName === null
                ? "Show the whole register"
                : `Showing ${selectedLocationName} — show everything`}
            </Button>
          {/if}
        </div>

        <PacketRegister
          {query}
          {locations}
          onOpenPacket={openPacket}
          caption="The firm's custody register"
          emptyTitle="Nothing Is In Custody Yet"
        >
          {#snippet emptyBody()}
            A packet is the physical thing the firm holds and moves: an envelope, a deed box, a
            sealed wallet. It carries a custody number, the person or organization it is held for,
            and everything that has ever happened to it. Logging the first one draws the firm's first
            custody number.
          {/snippet}
        </PacketRegister>
      </div>
    </div>
  </Tabs.Content>

  <Tabs.Content value="owners" class="min-w-0">
    <HoldingsByOwner />
  </Tabs.Content>

  <Tabs.Content value="holds" class="min-w-0">
    <HoldsInForce />
  </Tabs.Content>

  <Tabs.Content value="due" class="min-w-0">
    <div class="flex flex-col gap-24">
      <div class="flex flex-col gap-12">
        <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
          Out past its due-back date
        </h2>
        <OverdueCheckouts onOpenPacket={openPacket} />
      </div>
      <div class="flex flex-col gap-12">
        <h2 class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
          Due for a look
        </h2>
        <RemindersDue onOpenPacket={openPacket} />
      </div>
    </div>
  </Tabs.Content>
</Tabs.Root>

<PacketWindow bind:open={windowOpen} packetId={openPacketId} {locations} />
