<script lang="ts">
  /*
   * One shipment — read over the register, never on a page of its own.
   *
   * WHY A WINDOW. The reader is triaging a list: they want to know where one parcel is and then go
   * back to the list. A purchased shipment has no editing mode at all, so a screen of its own would
   * be a page whose only remaining job is a way back — which is the directory's ruling of 2026-09-05
   * applied to the same shape ("a record opened in place needs no way back"). /shipping/[id] survives
   * as the address and redirects here.
   *
   * WHY THE RECORD WINDOW RATHER THAN THE READING PANEL. A shipment has a history and two acts —
   * fetch the label, void an unused one — and the second of those is destructive and about money. The
   * reading kind is for a fact with a step beside it; this is a record with a tab strip.
   *
   * TRACKING IS ASKED FOR, NOT ASSUMED. The tracking route is a live call to the carrier, so it runs
   * when the reader opens the tab rather than on every window open: a register where somebody clicks
   * through ten rows would otherwise be ten carrier calls nobody asked for. What is on screen is
   * therefore always what the carrier said just now, and the tab says when it was asked.
   */
  import { createQuery } from "@tanstack/svelte-query";
  import { shippingReadShipmentOptions } from "@magna-carta/api-client";
  import RecordWindow from "@magna-carta/design-system/record-window";
  import type { RecordWindowTab } from "@magna-carta/design-system/record-window";
  import Button from "@magna-carta/design-system/button";
  import * as DefinitionList from "@magna-carta/design-system/definition-list";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { formatInstant } from "@magna-carta/design-system/formatters";
  import { toast } from "@magna-carta/design-system/toast";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import { openBeside } from "$lib/navigation/open-beside.ts";
  import { readLabelObjectUrl, readTracking, refundShipment } from "$lib/shipping/shipping-api.ts";
  import { formatMinorUnits, shipmentStatusLabel } from "$lib/shipping/shipment-columns.ts";

  let {
    shipmentId,
    open = $bindable(false),
    onClosed,
    onRefunded,
  }: {
    /** The shipment being read, or null when the window is closed. */
    shipmentId: string | null;
    open?: boolean;
    /** Called once the window has closed, so the caller can clear the address it opened from. */
    onClosed?: () => void;
    /** Called after a successful refund, so the register can re-read the row that changed. */
    onRefunded?: () => void;
  } = $props();

  interface TrackingEvent {
    readonly status: string;
    readonly occurredAt: string | null;
    readonly location: string | null;
    readonly message: string | null;
  }

  const shipment = createQuery(() => ({
    ...shippingReadShipmentOptions({ path: { id: shipmentId ?? "" } }),
    enabled: shipmentId !== null,
  }));

  const refundIntent = new WriteIntent();
  let refunding = $state(false);

  let tracking = $state<readonly TrackingEvent[] | null>(null);
  let trackingAskedAt = $state<string | null>(null);
  let trackingFailed = $state(false);
  let asking = $state(false);

  const record = $derived(shipment.data ?? null);
  const status = $derived(record === null ? null : shipmentStatusLabel(record.status));
  // Only an unused label can be voided. A parcel already moving is the carrier's problem and not a
  // refund, and offering the act where it cannot apply is worse than not offering it.
  const refundable = $derived(record?.status === "purchased");
  const heading = $derived(recipientOf(record?.toAddress) ?? "Shipment");
  // The citation beneath the heading: what carried it, by what service, and where it stands. A
  // snippet rather than a string because the window's subtitle takes either, and this one is three
  // facts a shipment may hold none of yet.
  const subtitleText = $derived(
    record === null ? "" : [record.carrier, record.service, status].filter(Boolean).join(" · "),
  );

  function recipientOf(address: unknown): string | null {
    if (typeof address !== "object" || address === null) return null;
    const { name } = address as Record<string, unknown>;
    return typeof name === "string" ? name : null;
  }

  function addressLines(address: unknown): string {
    if (typeof address !== "object" || address === null) return "";
    const parts = address as Record<string, unknown>;
    const line = (key: string): string => (typeof parts[key] === "string" ? parts[key] : "");
    return [line("street1"), line("street2"), `${line("city")} ${line("state")} ${line("zip")}`]
      .map((part) => part.trim())
      .filter((part) => part !== "")
      .join(", ");
  }

  async function askTracking(): Promise<void> {
    if (shipmentId === null || asking) return;
    asking = true;
    trackingFailed = false;
    try {
      const answer = await readTracking(shipmentId);
      if (answer.error !== undefined || answer.data === undefined) {
        trackingFailed = true;
        return;
      }
      tracking = answer.data.events as readonly TrackingEvent[];
      trackingAskedAt = new Date().toISOString();
    } finally {
      asking = false;
    }
  }

  async function refund(): Promise<void> {
    if (shipmentId === null) return;
    refunding = true;
    try {
      const outcome = await refundIntent.submit((key) => refundShipment(shipmentId, key));
      if (outcome.value.error !== undefined) {
        toast.error("The label could not be voided.");
        return;
      }
      toast.success("Label voided");
      onRefunded?.();
    } finally {
      refunding = false;
    }
  }

  /*
   * What printing a shipment means: the label.
   *
   * The window requires a print gesture of every record, and for this one there is exactly one thing
   * anybody prints — the carrier label that goes on the parcel. It is served from the firm's own
   * storage rather than the carrier's expiring URL. A shipment with no label yet is a draft, and
   * saying so is better than a gesture that appears to work and produces nothing.
   */
  async function openLabel(): Promise<void> {
    if (shipmentId === null || record === null || !record.hasLabel) {
      toast.error("This shipment has no label yet.");
      return;
    }
    const url = await readLabelObjectUrl(shipmentId);
    if (url === null) {
      toast.error("The label could not be fetched.");
      return;
    }
    // Through the one helper every new-tab opening in the application goes through, rather than a
    // bare window.open: the isolation a second tab gets is decided in one place, not per caller.
    openBeside(url, "file");
    // Released once the browser has taken it. Held any longer and every label opened in a session
    // stays in memory for as long as the tab does.
    setTimeout(() => URL.revokeObjectURL(url), LABEL_URL_LIFETIME_MS);
  }

  /* Long enough for the new tab to have read the blob, short enough that nothing accumulates. */
  const LABEL_URL_LIFETIME_MS = 60_000;

  // The tab is asked for once per window. Re-opening the same shipment asks again, which is right:
  // the question is "where is it now", and a cached answer from an hour ago is the wrong one.
  $effect(() => {
    if (!open) {
      tracking = null;
      trackingAskedAt = null;
      trackingFailed = false;
    }
  });
</script>

{#snippet subtitle()}
  <span>{subtitleText}</span>
{/snippet}

{#snippet detailsPane()}
  <LoadingRegion
    loading={shipment.isPending}
    failed={shipment.isError}
    label="Reading the shipment"
    onRetry={() => void shipment.refetch()}
    class="flex flex-col gap-16"
  >
    {#snippet failure()}
      <p class="py-12 text-sm text-text-muted">This shipment could not be read.</p>
    {/snippet}
    {#if record !== null}
      <DefinitionList.Root>
        <DefinitionList.Row term="To">{addressLines(record.toAddress)}</DefinitionList.Row>
        <DefinitionList.Row term="From">{addressLines(record.fromAddress)}</DefinitionList.Row>
        <DefinitionList.Row term="Status">{status ?? ""}</DefinitionList.Row>
        <DefinitionList.Row term="Tracking" empty={record.trackingCode === null}>
          {record.trackingCode ?? "Not yet bought"}
        </DefinitionList.Row>
        <DefinitionList.Row term="Postage" empty={record.postageCostMinor === null}>
          {formatMinorUnits(record.postageCostMinor, record.currency)}
        </DefinitionList.Row>
        <!-- Its own row for the reason it is its own column on the register: postage is billed on to
             a client and the platform's fee may not be, so the two are never one figure. -->
        <DefinitionList.Row term="Service fee" empty={record.serviceFeeMinor === null}>
          {formatMinorUnits(record.serviceFeeMinor, record.currency)}
        </DefinitionList.Row>
        <DefinitionList.Row term="Matter" empty={record.matterRef === null}>
          {record.matterRef ?? "None"}
        </DefinitionList.Row>
      </DefinitionList.Root>
    {/if}
  </LoadingRegion>
{/snippet}

{#snippet trackingTab()}
  <div class="flex flex-col gap-12">
    <div class="flex items-center gap-8">
      <Button variant="secondary" size="sm" disabled={asking} onclick={() => void askTracking()}>
        {asking ? "Asking the carrier" : "Check now"}
      </Button>
      {#if trackingAskedAt !== null}
        <!-- When the answer was taken, not just what it was: tracking is a live call, and an event
             list with no timestamp beside it reads as current forever. -->
        <span class="text-sm text-text-muted">Asked {formatInstant(trackingAskedAt)}</span>
      {/if}
    </div>

    {#if trackingFailed}
      <p class="text-sm text-text-muted">
        The carrier didn't respond. Nothing about the parcel changed.
      </p>
    {:else if tracking === null}
      <p class="text-sm text-text-muted">Check now to ask the carrier where this parcel is.</p>
    {:else if tracking.length === 0}
      <EmptyState title="No Tracking Events" />
    {:else}
      <ol class="flex flex-col gap-8">
        {#each tracking as event, index (`${event.status}-${String(index)}`)}
          <li class="flex flex-col border-s ps-12">
            <span class="font-medium">{event.status}</span>
            {#if event.message !== null}<span class="text-sm">{event.message}</span>{/if}
            <span class="text-sm text-text-muted">
              {[event.location, event.occurredAt === null ? null : formatInstant(event.occurredAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </div>
{/snippet}

{#snippet actions()}
  {#if record !== null && record.hasLabel}
    <!-- The label is served from the firm's own storage, never hotlinked from the carrier: the
         carrier's URL expires, and a button that works today and not next week is worse than none. -->
    <Button variant="secondary" size="sm" onclick={() => void openLabel()}>Label</Button>
  {/if}
  {#if refundable}
    <Button variant="destructive" size="sm" disabled={refunding} onclick={() => void refund()}>
      {refunding ? "Voiding" : "Void Label"}
    </Button>
  {/if}
{/snippet}

<RecordWindow
  bind:open
  {heading}
  {subtitle}
  record={detailsPane}
  {actions}
  tabs={[{ key: "tracking", label: "Tracking", content: trackingTab }] satisfies RecordWindowTab[]}
  unsavedChanges={false}
  onCancel={onClosed}
  onPrint={() => void openLabel()}
/>
