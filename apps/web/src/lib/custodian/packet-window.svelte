<script lang="ts">
  /*
   * One packet, in the window every record in this product opens in.
   *
   * The left pane is the packet itself: its number, where it is, whom it is held for, and — set
   * first, above everything descriptive — what stands against it. The right pane is context: what is
   * inside, the holds, the scanned copies, and the chain of custody.
   *
   * CONTENTS AND HISTORY ARE THE SAME LEDGER AT TWO SCOPES. Each item in Contents opens onto its own
   * chain of custody, because the question a firm is asked is about the object rather than the
   * envelope: where has this will been, and who has had it. The History tab is the whole packet's,
   * and an entry there about one item names the item. Neither is a second record, so the two can
   * never come to disagree about the same object.
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
  import * as Accordion from "@magna-carta/design-system/accordion";
  import * as Alert from "@magna-carta/design-system/alert";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import EventRail, { orderedOldestFirst } from "@magna-carta/design-system/event-rail";
  import Label from "@magna-carta/design-system/label";
  import PrintSheet from "@magna-carta/design-system/print-sheet";
  import RecordWindow, { type RecordWindowTab } from "@magna-carta/design-system/record-window";
  import type {
    RecordReference,
    RecordSubject,
  } from "@magna-carta/design-system/record-reference";
  import Separator from "@magna-carta/design-system/separator";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleDate, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import FileText from "@lucide/svelte/icons/file-text";
  import Plus from "@lucide/svelte/icons/plus";
  import { SoonAffordance } from "@magna-carta/design-system/maturity";
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
    scanKindLabel,
  } from "./custody-vocabulary.ts";
  import AddItemDialog from "./add-item-dialog.svelte";
  import ItemHistory from "./item-history.svelte";
  import LinkScanDialog from "./link-scan-dialog.svelte";
  import { permissionRefusal } from "$lib/access/refusal.ts";

  let {
    open = $bindable(false),
    packetId,
    locations,
    mayManage = false,
  }: {
    /** Whether the window is showing. */
    open?: boolean;
    /** The packet to read, or null when nothing is selected. */
    packetId: string | null;
    /** The firm's container tree, so a movement's from and to nodes read as names. */
    locations: readonly CustodyLocationNode[];
    /**
     * Whether this member may write to the register.
     *
     * Passed down rather than read here: the surface that opened this window has already asked who
     * is signed in, and a window that asked again would be a second request for an answer the page
     * is holding, made every time somebody opens a row.
     */
    mayManage?: boolean;
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
  let loadFailure = $state<StatedFailure | null>(null);
  /** True while a packet already on screen is being read again; the pane stays where it is. */
  let rereading = $state(false);
  let printOpen = $state(false);
  let itemDialogOpen = $state(false);
  let scanDialogOpen = $state(false);
  /** Which items have been opened onto their own history. Opening is what reads the ledger. */
  let openItemIds = $state<string[]>([]);
  let shownPacketId: string | null = null;

  const directory = new DirectoryNames();

  // Two client-side joins, both read once per surface rather than once per row: the firm's member
  // roster puts a name to whoever recorded a movement, and the container tree names the nodes a
  // movement went between. A handle neither answers for renders as the gap, never as the handle.
  const memberNames = $derived(
    new Map((firmRoster.members ?? []).map((member) => [member.userId, member.displayName])),
  );
  const locationNames = $derived(new Map(locations.map((node) => [node.id, node.name])));

  // The packet's own items, so a history row about one of them names it rather than reading as an
  // unexplained entry in the middle of the packet's own story.
  const itemNames = $derived(
    new Map(
      (packet?.items ?? []).map((item) => [item.id, `Item ${item.ordinal}: ${item.description}`]),
    ),
  );

  const names: CustodyNameLookup = {
    member: (userId) => memberNames.get(userId) ?? null,
    location: (locationId) => locationNames.get(locationId) ?? null,
    entity: (entityId) => directory.nameOf(entityId),
    item: (itemId) => itemNames.get(itemId) ?? null,
  };

  async function read(asked: string): Promise<void> {
    // The roster settles its own failure internally and is shared across the app; asking again
    // when it is already read costs nothing.
    void firmRoster.load(fetch);
    loadFailure = null;
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
      loadFailure = stated(detail.failure, "This packet could not be read.");
    }
    // A ledger that failed leaves the packet readable: where the property is and whom it is held
    // for are still true, and the history says its own absence rather than failing the window.
    movements = ledger.kind === "ok" ? ledger.value.data : [];
  }

  $effect(() => {
    const asked = packetId;
    if (asked === null || !open) return;
    if (shownPacketId === asked) return;
    shownPacketId = asked;
    packet = null;
    movements = null;
    loadFailure = null;
    // A different packet's items are different items; keeping the last one's open set would open
    // rows that are not there and leave this packet's contents shut.
    openItemIds = [];
    void read(asked);
  });

  /*
   * Read the packet again after writing to it.
   *
   * The whole window is re-read rather than the one list that changed, because describing an item
   * appends to the chain of custody as well as to the contents: a window that patched its own
   * Contents tab would show a packet whose history did not mention the thing now sitting in it.
   */
  function reread(): void {
    const asked = shownPacketId;
    if (asked === null) return;
    rereading = packet !== null;
    void read(asked).finally(() => {
      rereading = false;
    });
  }

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

  /** Why a write control is refused, or undefined where it is not. */
  const writeRefusal = $derived(
    mayManage
      ? undefined
      : permissionRefusal("Writing to the register", "custody:manage"),
  );

  const heading = $derived(packet?.name ?? "Custody Packet");
  const sheet = $derived(
    packet === null ? null : packetPrintSheet(packet, (id) => directory.nameOf(id), events),
  );

  /*
   * The packet by its custody number — the window's own line, and the line the two panels opened
   * from here state as well, so the packet an item is being added to reads the same in all three.
   * While the register is still being read there is no number to show, and the line says what it is
   * doing rather than standing empty: a subtitle holds one line and has no shape to render.
   */
  const packetReference = $derived<RecordReference | null>(
    packet === null ? null : { kind: "Packet", number: packet.custodyNumber },
  );
  const subtitle = $derived<RecordSubject>(
    packetReference === null ? { facts: ["Reading the register"] } : { reference: packetReference },
  );
</script>

{#snippet fact(label: string, value: string)}
  <div class="flex flex-col gap-4">
    <Label>{label}</Label>
    <span>{value}</span>
  </div>
{/snippet}

{#snippet record()}
  <LoadingRegion
    loading={packet === null}
    failed={loadFailure !== null}
    refreshing={rereading}
    label="Reading this packet"
    onRetry={reread}
  >
    {#snippet failure()}
      {#if loadFailure !== null}
        <FailureNotice
          failure={loadFailure.failure}
          title="This Packet Could Not Be Read"
          fallback={loadFailure.fallback}
          whenSilent={loadFailure.whenSilent}
          onRetry={reread}
        />
      {/if}
    {/snippet}
    <!-- The pane's own anatomy over sample words: the status, the four facts, whom it is held
         for. The labels stay readable; the values grey. The name and the dates are the sample
         vocabulary's; the place and the role are this register's own words. -->
    {#snippet fixture()}
      <div class="flex flex-col gap-16">
        <div class="flex flex-wrap items-center gap-8">
          <Badge variant="neutral">In custody</Badge>
        </div>
        <div class="grid gap-12 sm:grid-cols-2">
          {@render fact("Location", "Vault › Cabinet 3 › Drawer B")}
          {@render fact("Deposited", sampleDate(2))}
          {@render fact("Depositor", samplePerson(0).name)}
          {@render fact("Next review", sampleDate(3))}
        </div>
        <Separator />
        <div class="flex flex-col gap-8">
          <Label>Held for</Label>
          <div class="flex flex-wrap items-baseline gap-8">
            <span>{samplePerson(0).name}</span>
            <span class="text-xs text-text-muted">Testator</span>
          </div>
        </div>
      </div>
    {/snippet}
    {#if packet !== null}
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
            {firmRoster.failure} The history shows without who recorded each movement until it loads.
          </p>
        {/if}
      </div>
    {/if}
  </LoadingRegion>
{/snippet}

{#snippet describeItemButton()}
  <Button
    variant="secondary"
    disabled={packet === null || writeRefusal !== undefined}
    title={writeRefusal}
    onclick={() => (itemDialogOpen = true)}
  >
    <Plus class="size-16" aria-hidden="true" />
    Describe An Item
  </Button>
{/snippet}

{#snippet fileCopyButton()}
  <Button
    variant="secondary"
    disabled={packet === null || writeRefusal !== undefined}
    title={writeRefusal}
    onclick={() => (scanDialogOpen = true)}
  >
    <Plus class="size-16" aria-hidden="true" />
    File A Copy
  </Button>
{/snippet}

{#snippet contentsTab()}
  {#if packet === null || packet.items.length === 0}
    <EmptyState title="Nothing Described Yet" actions={describeItemButton}>
      No contents recorded yet. Describe what's inside item by item, so the register can show whether the firm holds a person's original will.
    </EmptyState>
  {:else}
    <div class="flex flex-col gap-12">
      <!-- Each item opens onto its own chain of custody. The question a firm is asked is about the
           OBJECT — where has this will been — and a packet that held one history for the whole
           envelope could only answer it about the box. Opening is what reads the ledger, so a
           packet with nine items draws a list rather than nine histories nobody asked for. -->
      <!-- The wrapper passes `value`/`onValueChange` through rather than exposing a bindable, so
           the open set is held here and handed back. -->
      <Accordion.Root
        type="multiple"
        value={openItemIds}
        onValueChange={(value) => (openItemIds = value)}
      >
        {#each packet.items as item (item.id)}
          <Accordion.Item value={item.id}>
            <Accordion.Trigger>
              <span class="flex min-w-0 flex-col gap-4 text-start">
                <span class="flex flex-wrap items-center gap-8">
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
                </span>
                <span class="text-xs text-text-muted">
                  Item {item.ordinal}{item.instrumentDate === null
                    ? ""
                    : ` · dated ${item.instrumentDate}`}{item.reviewOn === null
                    ? ""
                    : ` · review ${item.reviewOn}`}
                </span>
              </span>
            </Accordion.Trigger>
            <Accordion.Content>
              {#if openItemIds.includes(item.id) && packetId !== null}
                <ItemHistory
                  {packetId}
                  itemId={item.id}
                  label={item.description}
                  {names}
                />
              {/if}
            </Accordion.Content>
          </Accordion.Item>
        {/each}
      </Accordion.Root>
      <div class="flex">{@render describeItemButton()}</div>
    </div>
  {/if}
{/snippet}

{#snippet holdsTab()}
  {#if packet === null || packet.holds.length === 0}
    <EmptyState title="No Holds Recorded">
      A hold stops this item from leaving the firm's custody or being destroyed. It can still be moved somewhere safer.
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
    <EmptyState title="No Scanned Copies" actions={fileCopyButton}>
      A scan is an ordinary document on a matter, linked here. It never replaces the original and doesn't change what can be done with it.
    </EmptyState>
  {:else}
    <div class="flex flex-col gap-8">
      {#each packet.scans as scan (scan.id)}
        <div class="flex items-center gap-8">
          <FileText class="size-16 text-text-muted" aria-hidden="true" />
          <!-- The register's own word for what the copy is. The enum was being printed raw, so a
               piece of correspondence read as `correspondence`. -->
          <span>{scanKindLabel(scan.kind)}</span>
          <span class="text-xs text-text-muted">captured {scan.capturedAt}</span>
        </div>
      {/each}
      <div class="flex">{@render fileCopyButton()}</div>
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

<AddItemDialog bind:open={itemDialogOpen} {packetId} reference={packetReference} onAdded={reread} />

<LinkScanDialog
  bind:open={scanDialogOpen}
  {packetId}
  reference={packetReference}
  filingMatterId={packet?.filingMatterId ?? null}
  items={packet?.items ?? []}
  onLinked={reread}
/>
