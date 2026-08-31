<script lang="ts">
  /*
   * One packet, in the window every record in this product opens in.
   *
   * The left pane is the packet itself: its number, where it is, whom it is held for, and — set
   * first, above everything descriptive — what stands against it. The right pane is context: what is
   * inside, the holds, the scanned copies, and the chain of custody.
   *
   * WHY THE REFUSALS LEAD. A firm holding an original will or a set of deeds is answerable for it,
   * and the two acts it never comes back from are releasing the property and destroying it. Both are
   * refused by the server under conditions the person standing at the safe cannot see — a hold
   * somebody placed last year, an item marked irreplaceable. A greyed-out control with nothing said
   * is the shape of a defect; a reader who cannot see why will look for another way round. So every
   * refusal is drawn, in words, before the reader reaches the action bar, and the controls carry the
   * same sentence on their hover and as their accessible description.
   *
   * OWNER NAMES ARE RESOLVED HERE AND ONLY HERE. The register stores directory handles and resolves
   * none of them. A packet carries a handful, which is a bounded read for a record somebody opened
   * deliberately — see directory-names.svelte.ts for why this is not offered to a listing.
   *
   * The window is the surface's, not the listing's: every panel that names a packet — the register,
   * the overdue list, what is due — opens THIS one, so a reader meets the same window whichever
   * door they came through.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import EventRail, { orderedOldestFirst } from "@magna-carta/design-system/event-rail";
  import Label from "@magna-carta/design-system/label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import Separator from "@magna-carta/design-system/separator";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import FileText from "@lucide/svelte/icons/file-text";
  import SoonAffordance from "$lib/maturity/soon-affordance.svelte";
  import { firmRoster } from "$lib/members/firm-roster.svelte.ts";
  import {
    listCustodyMovements,
    readCustodyPacket,
    type CustodyLocationNode,
    type CustodyMovement,
    type CustodyPacketDetail,
  } from "./custody-api.ts";
  import { movementEvents, type CustodyNameLookup } from "./custody-movements.ts";
  import { DirectoryNames } from "./directory-names.svelte.ts";
  import {
    destructionVerdict,
    holdsInForce,
    refusalSummary,
    releaseVerdict,
  } from "./release-gate.ts";
  import { locationBreadcrumb, packetPrintSheet } from "./packet-sheet.ts";
  import {
    holdLabel,
    holdMeaning,
    itemStatusEntry,
    packetStatusEntry,
  } from "./custody-vocabulary.ts";

  let {
    open = $bindable(false),
    packetId,
    locations,
  }: {
    /** Whether the window is showing. */
    open?: boolean;
    /** The packet to read, or null when nothing is selected. */
    packetId: string | null;
    /** The firm's container tree, so a movement's from and to nodes read as names. */
    locations: readonly CustodyLocationNode[];
  } = $props();

  /** What the movement form and the release capture form are waiting on, said the same way twice. */
  const MOVEMENT_FORM = "the movement form, which records who has the property and when it is due back";
  const RELEASE_FORM =
    "the release capture form, which records the authority a release is made on and the identity check made before the property leaves";
  const DESTRUCTION_FORM =
    "the destruction request form, which records the basis a second person then approves or refuses";
  const PACKET_FORM = "the packet form";

  let packet = $state<CustodyPacketDetail | null>(null);
  let movements = $state<readonly CustodyMovement[] | null>(null);
  let loadFailure = $state<string | null>(null);
  let printOpen = $state(false);
  let shownPacketId: string | null = null;

  const directory = new DirectoryNames();

  // Two client-side joins, both read once per surface rather than once per row: the firm's member
  // roster puts a name to whoever recorded a movement, and the container tree names the nodes a
  // movement went between. A handle neither answers for renders as the gap, never as the handle.
  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );
  const locationNames = $derived(new Map(locations.map((node) => [node.id, node.name])));

  const names: CustodyNameLookup = {
    member: (userId) => memberNames.get(userId) ?? null,
    location: (locationId) => locationNames.get(locationId) ?? null,
    entity: (entityId) => directory.nameOf(entityId),
  };

  $effect(() => {
    const asked = packetId;
    if (asked === null || !open) return;
    if (shownPacketId === asked) return;
    shownPacketId = asked;
    packet = null;
    movements = null;
    loadFailure = null;
    // The roster settles its own failure internally and is shared across the app; asking again
    // when it is already read costs nothing.
    void firmRoster.load(fetch);
    void (async () => {
      const [detail, ledger] = await Promise.all([
        readCustodyPacket(fetch, asked),
        listCustodyMovements(fetch, asked),
      ]);
      if (shownPacketId !== asked) return;
      if (detail.kind === "ok") {
        packet = detail.value;
        const handles = [
          ...detail.value.owners.map((owner) => owner.entityId),
          ...(detail.value.depositorEntityId === null ? [] : [detail.value.depositorEntityId]),
        ];
        void directory.resolve(fetch, handles);
      } else {
        loadFailure =
          detail.kind === "transport"
            ? "Nothing answered. This packet could not be read."
            : (detail.problem.detail ?? "This packet could not be read.");
      }
      // A ledger that failed leaves the packet readable: where the property is and whom it is held
      // for are still true, and the history says its own absence rather than failing the window.
      movements = ledger.kind === "ok" ? ledger.value.data : [];
    })();
  });

  const standingHolds = $derived(packet === null ? [] : holdsInForce(packet.holds));
  const release = $derived(
    packet === null ? null : releaseVerdict({ status: packet.status, holds: packet.holds }),
  );
  const destruction = $derived(
    packet === null
      ? null
      : destructionVerdict({ status: packet.status, holds: packet.holds, items: packet.items }),
  );

  const events = $derived(
    movements === null ? [] : orderedOldestFirst(movementEvents(movements, names)),
  );

  const heading = $derived(packet?.name ?? "Custody Packet");
  const sheet = $derived(
    packet === null ? null : packetPrintSheet(packet, (id) => directory.nameOf(id), events),
  );
</script>

{#snippet subtitle()}
  {#if packet === null}
    Reading the register
  {:else}
    <span class="tabular-nums">{packet.custodyNumber}</span>
  {/if}
{/snippet}

{#snippet fact(label: string, value: string)}
  <div class="flex flex-col gap-4">
    <Label>{label}</Label>
    <span>{value}</span>
  </div>
{/snippet}

{#snippet record()}
  {#if loadFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>This Packet Could Not Be Read</Alert.Title>
      <Alert.Description>{loadFailure}</Alert.Description>
    </Alert.Root>
  {:else if packet === null}
    <div class="flex flex-col gap-12" aria-busy="true" aria-label="Reading this packet">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else}
    <div class="flex flex-col gap-16">
      <!-- What stands against this packet, first. A reader has to meet a hold before they meet a
           control that a hold refuses. -->
      {#if standingHolds.length > 0}
        <Alert.Root variant="warning">
          <Alert.Title>This Packet Is Under Hold</Alert.Title>
          <Alert.Description>
            <div class="flex flex-col gap-8">
              {#each standingHolds as hold (hold.id)}
                <span title={holdMeaning(hold.kind)}>
                  {holdLabel(hold.kind)}: {hold.reason ?? "no reason recorded"}
                </span>
              {/each}
              <span>
                It cannot be released or destroyed while a hold stands. It can still be moved.
              </span>
            </div>
          </Alert.Description>
        </Alert.Root>
      {/if}

      <div class="flex flex-wrap items-center gap-8">
        <Badge
          variant={packetStatusEntry(packet.status).tone}
          title={packetStatusEntry(packet.status).meaning}
        >
          {packetStatusEntry(packet.status).label}
        </Badge>
        {#if packet.numberSource === "manual"}
          <Badge variant="neutral" title="Carried in from an earlier register. It drew no number.">
            Carried in
          </Badge>
        {/if}
      </div>

      <div class="grid gap-12 sm:grid-cols-2">
        {@render fact("Location", locationBreadcrumb(packet))}
        {@render fact("Deposited", packet.depositedAt ?? "Not recorded")}
        {@render fact(
          "Depositor",
          packet.depositorEntityId === null
            ? "Not recorded"
            : (directory.nameOf(packet.depositorEntityId) ?? "Not named here"),
        )}
        {@render fact("Next review", packet.reviewOn ?? "None scheduled")}
      </div>

      <Separator />

      <div class="flex flex-col gap-8">
        <Label>Held for</Label>
        {#each packet.owners as owner (owner.id)}
          <div class="flex flex-wrap items-baseline gap-8">
            <span>{directory.nameOf(owner.entityId) ?? "Not named here"}</span>
            <span class="text-xs text-text-muted">
              {owner.ownershipRole ?? "Owner"}{owner.effectiveTo === null
                ? ""
                : ` · ended ${owner.effectiveTo}`}
            </span>
          </div>
        {/each}
      </div>

      {#if packet.matterId !== null}
        <div class="flex flex-col gap-4">
          <Label>Matter</Label>
          <a class="underline underline-offset-2" href="/matters/{packet.matterId}">
            Open the matter this packet is linked to
          </a>
        </div>
      {/if}

      {#if packet.notes !== null && packet.notes.trim() !== ""}
        <div class="flex flex-col gap-4">
          <Label>Notes</Label>
          <span>{packet.notes}</span>
        </div>
      {/if}

      {#if release !== null && !release.permitted}
        <div class="flex flex-col gap-8">
          <Label>Why this cannot be released</Label>
          {#each release.refusals as refusal (refusal.key)}
            <span class="text-xs text-text-muted">{refusal.reason}</span>
          {/each}
        </div>
      {/if}

      {#if destruction !== null && !destruction.permitted}
        <div class="flex flex-col gap-8">
          <Label>Why this cannot be destroyed</Label>
          {#each destruction.refusals as refusal (refusal.key)}
            <span class="text-xs text-text-muted">{refusal.reason}</span>
          {/each}
        </div>
      {/if}

      {#if firmRoster.failure !== null}
        <!-- Said once, plainly, and only when it happened: the history reads without the names of
             whoever recorded each movement because the roster could not be read, not because the
             ledger recorded nobody. -->
        <p class="text-xs text-text-muted">
          {firmRoster.failure} The history reads without the names of whoever recorded each movement
          until it can.
        </p>
      {/if}
    </div>
  {/if}
{/snippet}

{#snippet contentsTab()}
  {#if packet === null || packet.items.length === 0}
    <EmptyState title="Nothing Described Yet">
      A packet can be logged before anyone opens it, and this one has no contents recorded. What is
      inside is described item by item, which is how the register answers whether the firm holds an
      original will for somebody.
    </EmptyState>
  {:else}
    <div class="flex flex-col gap-12">
      {#each packet.items as item (item.id)}
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-8">
            <span>{item.description}</span>
            <Badge
              variant={itemStatusEntry(item.status).tone}
              title={itemStatusEntry(item.status).meaning}
            >
              {itemStatusEntry(item.status).label}
            </Badge>
            {#if item.intrinsicValue}
              <Badge
                variant="accent"
                title="An irreplaceable original. It is never destructible, and the refusal has no override."
              >
                Irreplaceable original
              </Badge>
            {/if}
          </div>
          <span class="text-xs text-text-muted">
            Item {item.ordinal}{item.instrumentDate === null
              ? ""
              : ` · dated ${item.instrumentDate}`}{item.reviewOn === null
              ? ""
              : ` · review ${item.reviewOn}`}
          </span>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet holdsTab()}
  {#if packet === null || packet.holds.length === 0}
    <EmptyState title="No Holds Recorded">
      A hold forbids this property leaving the firm's custody or ceasing to exist. It deliberately
      does not stop it being moved, because a held original still has to be movable somewhere safer.
    </EmptyState>
  {:else}
    <div class="flex flex-col gap-12">
      {#each packet.holds as hold (hold.id)}
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center gap-8">
            <span>{holdLabel(hold.kind)}</span>
            <Badge
              variant={hold.releasedAt === null ? "warning" : "neutral"}
              title={holdMeaning(hold.kind)}
            >
              {hold.releasedAt === null ? "In force" : "Released"}
            </Badge>
          </div>
          <span class="text-xs text-text-muted">
            Placed {hold.placedAt}{hold.releasedAt === null
              ? ""
              : ` · released ${hold.releasedAt}`}{hold.itemId === null ? "" : " · on one item"}
          </span>
          {#if hold.reason !== null}
            <span class="text-xs text-text-muted">{hold.reason}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet scansTab()}
  {#if packet === null || packet.scans.length === 0}
    <EmptyState title="No Scanned Copies">
      A scan is an ordinary document filed on a matter, linked here. It is never a substitute for the
      original, and its existence changes nothing about what may be done with what the firm holds.
    </EmptyState>
  {:else}
    <div class="flex flex-col gap-8">
      {#each packet.scans as scan (scan.id)}
        <div class="flex items-center gap-8">
          <FileText class="size-16 text-text-muted" aria-hidden="true" />
          <span>{scan.kind}</span>
          <span class="text-xs text-text-muted">captured {scan.capturedAt}</span>
        </div>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet historyTab()}
  <EventRail
    {events}
    label="This packet's chain of custody"
    loading={movements === null}
    loadingMessage="Reading this packet's chain of custody"
    emptyMessage="Nothing has been recorded against this packet yet."
  />
{/snippet}

{#snippet actions()}
  <SoonAffordance reason={MOVEMENT_FORM}>
    {#snippet control(soon)}
      <Button variant="secondary" {...soon}>Check Out</Button>
    {/snippet}
  </SoonAffordance>
  <SoonAffordance reason={MOVEMENT_FORM}>
    {#snippet control(soon)}
      <Button variant="secondary" {...soon}>Check In</Button>
    {/snippet}
  </SoonAffordance>
  {#if release !== null && !release.permitted}
    <!-- The refusal outranks the missing form: a reader has to be told the register forbids this,
         not that a screen has not been built. -->
    <Button variant="secondary" disabled title={refusalSummary(release)}>Release</Button>
  {:else}
    <SoonAffordance reason={RELEASE_FORM}>
      {#snippet control(soon)}
        <Button variant="secondary" {...soon}>Release</Button>
      {/snippet}
    </SoonAffordance>
  {/if}
  {#if destruction !== null && !destruction.permitted}
    <Button variant="secondary" disabled title={refusalSummary(destruction)}>
      Request Destruction
    </Button>
  {:else}
    <SoonAffordance reason={DESTRUCTION_FORM}>
      {#snippet control(soon)}
        <Button variant="secondary" {...soon}>Request Destruction</Button>
      {/snippet}
    </SoonAffordance>
  {/if}
{/snippet}

<RecordWindow
  bind:open
  {heading}
  {subtitle}
  {record}
  {actions}
  tabs={[
    { key: "contents", label: "Contents", count: packet?.items.length, content: contentsTab },
    { key: "holds", label: "Holds", count: packet?.holds.length, content: holdsTab },
    { key: "scans", label: "Scans", count: packet?.scans.length, content: scansTab },
    { key: "history", label: "History", content: historyTab },
  ] satisfies RecordWindowTab[]}
  defaultTab="history"
  editDisabledReason={`Not built yet. Waiting on ${PACKET_FORM}.`}
  onPrint={() => (printOpen = true)}
/>

{#if sheet !== null}
  <PrintSheet bind:open={printOpen} {sheet} />
{/if}
