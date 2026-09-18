<script lang="ts">
  /*
   * Shipping & Postage — the register of what this firm has sent, and where it is.
   *
   * IT ANSWERS TWO QUESTIONS WITH ONE SET OF ROWS. "Where is the certified letter I sent on Tuesday"
   * and "what has this firm spent on postage" are asked by different people, so both sets of columns
   * are declared (shipment-columns.ts) and the reader chooses, sorts and filters — the same answer
   * every other register in the product gives, not a special case for this one.
   *
   * A SHIPMENT OPENS OVER THE REGISTER, never onto a page of its own. The reader is triaging a list;
   * a purchased shipment cannot be edited, and what they want after looking at one is the list back.
   * That is the directory's ruling applied here — a record opened in place needs no way back — and it
   * is why /shipping/[id] is a redirect into this screen rather than a screen of its own.
   *
   * WHEN NO ACCOUNT IS CONNECTED the register says so at the top instead of rendering an empty table
   * that looks like a firm which has never posted anything. Those are different sentences and the
   * remedy for each is different: one is a settings page, the other is the New button.
   */
  import Plus from "@lucide/svelte/icons/plus";
  import Settings from "@lucide/svelte/icons/settings";
  import { createQuery } from "@tanstack/svelte-query";
  import { shippingReadConnectionOptions } from "@magna-carta/api-client";
  import { buttonClasses } from "@magna-carta/design-system/button";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { PagedList } from "$lib/matters/paged-list.svelte.ts";
  import ShipmentWindow from "$lib/shipping/shipment-window.svelte";
  import {
    shipmentWindowHref,
    SHIPMENT_WINDOW_PARAMETER,
  } from "$lib/shipping/shipment-window-href.ts";
  import { readShipments, type ShipmentListRow } from "$lib/shipping/shipping-api.ts";
  import {
    shipmentRegisterColumns,
    SHIPMENT_REGISTER_INITIAL_SORT,
  } from "$lib/shipping/shipment-columns.ts";

  const list = new PagedList<ShipmentListRow>("This firm's shipments could not be read.");
  const rows = $derived(list.items);
  const connection = createQuery(() => shippingReadConnectionOptions());

  const connected = $derived(connection.data?.connected === true);
  // Only once the read has settled. Saying "nothing sent yet" while the first page is still in
  // flight would be a claim the screen cannot support.
  const registerIsEmpty = $derived(rows !== null && rows.length === 0);

  const read = (cursor?: string) => readShipments({ cursor });

  $effect(() => {
    void list.load(read);
  });

  /*
   * Which shipment is open comes from the ADDRESS, not from a local variable the row click sets.
   * That is what makes /shipping/[id] work — it redirects here with the parameter set — and what
   * lets the reader use the browser's own back button to close the window, which is the gesture they
   * will reach for whether or not the window offers one.
   */
  const openShipmentId = $derived(page.url.searchParams.get(SHIPMENT_WINDOW_PARAMETER));

  function openShipment(row: ShipmentListRow): void {
    void goto(shipmentWindowHref(row.id), { noScroll: true, keepFocus: true });
  }

  function closeShipment(): void {
    void goto("/shipping", { noScroll: true, keepFocus: true, replaceState: true });
  }

  const grid = DataTable.createDataTableGrid<ShipmentListRow>({
    columns: () => shipmentRegisterColumns(),
    rows: () => rows ?? [],
    rowKey: (row) => row.id,
    initialSort: SHIPMENT_REGISTER_INITIAL_SORT,
    itemNoun: { singular: "shipment", plural: "shipments" },
    onActivate: openShipment,
  });
</script>

<svelte:head><title>Shipping & Postage · Magna Carta</title></svelte:head>

<div class="flex h-full min-h-0 flex-col">
  <ScreenHeader title="Shipping & Postage" class="mb-24">
    {#snippet actions()}
      <a href="/shipping/new" class={buttonClasses({ variant: "primary", size: "default" })}>
        <Plus class="size-16" aria-hidden="true" />
        New Shipment
      </a>
      <a href="/settings/shipping" class={buttonClasses({ variant: "ghost", size: "default" })}>
        <Settings class="size-16" aria-hidden="true" />
        Postage Account
      </a>
      <DataTable.ClearFilters {grid} />
    {/snippet}
  </ScreenHeader>

  <!-- Stated before the table rather than inside its empty state: a firm with no account connected
       has a different problem from a firm that has simply not posted anything, and the remedy is a
       different screen. Shown once the connection read has settled, so a slow read never accuses a
       working account of being absent. -->
  {#if connection.isSuccess && !connected}
    <Alert.Root variant="warning" class="mb-24">
      <Alert.Title>No postage account is connected</Alert.Title>
      <Alert.Description>
        Shipments can be drafted, but nothing can be rated or bought until the firm's postage account
        is connected.
        <a href="/settings/shipping" class="underline">Connect it in settings</a>.
      </Alert.Description>
    </Alert.Root>
  {/if}

  {#if list.failure !== null && rows === null}
    <FailureNotice
      failure={list.failure}
      title="Shipments Could Not Be Read"
      fallback={list.failureMessage ?? undefined}
      onRetry={() => void list.load(read)}
    />
  {:else if registerIsEmpty}
    <EmptyState title="No Shipments" />
  {:else}
    <DataTable.Grid
      {grid}
      class="min-h-0 flex-1"
      caption="Everything this firm has sent"
      loading={rows === null}
    ></DataTable.Grid>

    <DataTable.GridFooter {grid}>
      {#snippet end()}
        <DataTable.LoadMore
          noun="shipments"
          more={list.nextCursor !== null}
          loading={list.loadingMore}
          onLoad={() => void list.loadMore(read)}
        />
      {/snippet}
    </DataTable.GridFooter>
  {/if}
</div>

<!-- Opened by the address rather than by this markup, so the window survives a reload and a link
     into it from anywhere else in the product. A refund changes the row behind it, so the register
     re-reads rather than leaving a voided label reading as bought. -->
<ShipmentWindow
  shipmentId={openShipmentId}
  open={openShipmentId !== null}
  onClosed={closeShipment}
  onRefunded={() => void list.load(read)}
/>
