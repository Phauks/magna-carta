<script lang="ts">
  /*
   * The Rooms tab of the entry window: what the event has booked, Book a Room, and Release.
   *
   * A booking belongs to exactly one event, so the event's window is where its rooms are read and
   * booked. The tab owns its read, its form and its failure; the catalog is read once per window,
   * lazily, because a deadline never books anything.
   *
   * THE BOOKING TAKES THE EVENT'S OWN WINDOW: the room is busy because the event is happening in
   * it. A booking that double-books LANDS and says so; refusing would make the platform referee
   * rooms it does not own, and must never be why a hearing cannot be recorded.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Label from "@magna-carta/design-system/label";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleDate } from "@magna-carta/design-system/loading-fixtures";
  import * as Select from "@magna-carta/design-system/select";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    createBooking,
    deleteBooking,
    formatWallClock,
    listEventBookings,
    listResources,
    resourceChipLabel,
    type EventBooking,
    type FirmResource,
  } from "./calendar-api.ts";
  import type { EntryRecord } from "./entry-reference.ts";

  const idPrefix = $props.id();

  let {
    record,
    reading,
    readerTimeZone,
    verbRefusal,
    bookingCount = $bindable(0),
    onChanged,
  }: {
    /** The record on screen; null while it is being read. */
    record: EntryRecord | null;
    /**
     * Whether the record itself is still being read. The tab cannot tell that from a record that
     * failed to read by looking at `record` alone, and the two look different: one draws the shape
     * the bookings will take, the other draws nothing because the record pane says why.
     */
    reading: boolean;
    /** The reader's own zone, so a booking's wall clock names a zone only where it differs. */
    readerTimeZone: string;
    /** Why Book and Release refuse, or undefined when the event is open to them. */
    verbRefusal: string | undefined;
    /** How many bookings the tab lists, for the count on the tab. */
    bookingCount?: number;
    /** Fired after a booking lands or is released, so the host re-reads what it paints. */
    onChanged: () => void;
  } = $props();

  let bookings = $state<readonly EventBooking[] | null>(null);
  let bookingsFailure = $state<StatedFailure | null>(null);
  let releaseFailure = $state<StatedFailure | null>(null);
  let resources = $state<readonly FirmResource[] | null>(null);
  let bookingsGeneration = 0;

  $effect(() => {
    bookingCount = bookings?.length ?? 0;
  });

  $effect(() => {
    void readBookings(record);
  });

  async function readBookings(target: EntryRecord | null): Promise<void> {
    bookingsGeneration += 1;
    const generation = bookingsGeneration;
    bookings = null;
    bookingsFailure = null;
    releaseFailure = null;
    if (target === null || target.kind === "deadline") return;
    const event = {
      kind: target.kind === "event" ? "matterEvent" : "firmEvent",
      id: target.event.id,
    } as const;
    const [outcome] = await Promise.all([listEventBookings(fetch, event), readResources()]);
    if (generation !== bookingsGeneration) return;
    if (outcome.kind === "ok") {
      bookings = outcome.value.data;
    } else {
      bookingsFailure = stated(outcome.failure, "The event's bookings could not be read.");
    }
  }

  async function readResources(): Promise<void> {
    if (resources !== null) return;
    const outcome = await listResources(fetch, true);
    if (outcome.kind === "ok") resources = outcome.value.data;
  }

  function resourceName(resourceId: string): string {
    const resource = resources?.find((candidate) => candidate.id === resourceId);
    return resource === undefined ? "A resource" : resourceChipLabel(resource);
  }

  function when(booking: EventBooking): string {
    const starts = formatWallClock(
      booking.startsAtTime,
      booking.timeZone,
      readerTimeZone,
      booking.startsOn,
    );
    const ends = formatWallClock(booking.endsAtTime, booking.timeZone, readerTimeZone, booking.startsOn);
    return `${booking.startsOn}${starts === null ? "" : ` ${starts}`}${ends === null ? "" : ` to ${ends}`}`;
  }

  async function releaseBooking(bookingId: string): Promise<void> {
    if (record === null) return;
    releaseFailure = null;
    const outcome = await deleteBooking(fetch, bookingId, crypto.randomUUID());
    if (outcome.kind === "ok") {
      void readBookings(record);
      onChanged();
      return;
    }
    releaseFailure = stated(outcome.failure, "The booking was not released.");
  }

  // ---- booking ----------------------------------------------------------------------------------

  let bookOpen = $state(false);
  let bookResourceId = $state("");
  let bookFailure = $state<StatedFailure | null>(null);
  let bookConflicts = $state(0);
  let bookAttemptKey: string | null = null;

  const bookableResources = $derived(
    (resources ?? [])
      .filter((resource) => resource.active)
      .map((resource) => ({ value: resource.id, label: resourceChipLabel(resource) })),
  );
  const bookRefusal = $derived(bookResourceId === "" ? "Choose what to book." : undefined);

  /** Open the Book a Room dialog; the window's action bar calls this. */
  export function openBook(): void {
    bookResourceId = "";
    bookFailure = null;
    bookConflicts = 0;
    bookAttemptKey = null;
    bookOpen = true;
  }

  async function commitBook(): Promise<ActionOutcome> {
    if (record === null || record.kind === "deadline" || bookResourceId === "") return "refused";
    bookFailure = null;
    bookAttemptKey ??= crypto.randomUUID();
    const outcome = await createBooking(
      fetch,
      record.kind === "event"
        ? { resourceId: bookResourceId, matterEventId: record.event.id }
        : { resourceId: bookResourceId, firmEventId: record.event.id },
      bookAttemptKey,
    );
    if (outcome.kind === "ok") {
      bookAttemptKey = null;
      bookConflicts = outcome.value.conflicts.length;
      void readBookings(record);
      onChanged();
      return "committed";
    }
    if (outcome.kind === "problem") bookAttemptKey = null;
    bookFailure = stated(
      outcome.failure,
      "The booking was not made.",
      "Couldn't connect. The booking wasn't made. Try again.",
    );
    return "refused";
  }

  // The shape the table takes while the bookings are read: the same table over sample words, greyed
  // by the loading region. Never a firm's own rooms; the dates are the sample vocabulary's.
  const BOOKING_FIXTURE = [
    { resource: "Conference Room A · Room", when: `${sampleDate(0)} 10:00 to 11:30` },
    { resource: "Pool Car 2 · Vehicle", when: `${sampleDate(0)} 09:00 to 12:00` },
  ];
</script>

{#if record === null && !reading}
  <!-- No record and no read in flight: the record pane states why, so this pane stays quiet. -->
  <p class="text-sm text-text-muted">&nbsp;</p>
{:else if record?.kind === "deadline"}
  <p class="text-sm text-text-muted">A deadline books nothing.</p>
{:else}
  <LoadingRegion
    loading={bookings === null}
    failed={bookingsFailure !== null}
    label="Reading the event's bookings"
    onRetry={() => void readBookings(record)}
    class="flex flex-col gap-8"
  >
    {#snippet failure()}
      {#if bookingsFailure !== null}
        <FailureNotice
          failure={bookingsFailure.failure}
          title="The Bookings Could Not Be Read"
          fallback={bookingsFailure.fallback}
          onRetry={() => void readBookings(record)}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      <DataTable.Root>
        <DataTable.Header>
          <DataTable.Row>
            <DataTable.Head>Resource</DataTable.Head>
            <DataTable.Head>When</DataTable.Head>
            <DataTable.Head class="sr-only">Release</DataTable.Head>
          </DataTable.Row>
        </DataTable.Header>
        <DataTable.Body>
          {#each BOOKING_FIXTURE as row (row.resource)}
            <DataTable.Row>
              <DataTable.Cell>{row.resource}</DataTable.Cell>
              <DataTable.Cell>{row.when}</DataTable.Cell>
              <DataTable.Cell class="text-end">
                <Button variant="ghost" size="sm">Release</Button>
              </DataTable.Cell>
            </DataTable.Row>
          {/each}
        </DataTable.Body>
      </DataTable.Root>
    {/snippet}
    {#if releaseFailure !== null}
      <FailureNotice failure={releaseFailure.failure} fallback={releaseFailure.fallback} />
    {/if}
    {#if bookConflicts > 0}
      <!-- Reported once, after the booking that made it: the room grid shows the pair. -->
      <p class="text-sm">
        Double-booked with {bookConflicts} other {bookConflicts === 1 ? "booking" : "bookings"}. Both bookings stand; the room grid shows them.
      </p>
    {/if}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">What this event has booked</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Resource</DataTable.Head>
          <DataTable.Head>When</DataTable.Head>
          <DataTable.Head class="sr-only">Release</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each bookings ?? [] as booking (booking.id)}
          <DataTable.Row>
            <DataTable.Cell>{resourceName(booking.resourceId)}</DataTable.Cell>
            <DataTable.Cell>{when(booking)}</DataTable.Cell>
            <DataTable.Cell class="text-end">
              <Button
                variant="ghost"
                size="sm"
                disabled={verbRefusal !== undefined}
                title={verbRefusal ?? "Free the resource; the event stays as it is"}
                onclick={() => void releaseBooking(booking.id)}
              >
                Release
              </Button>
            </DataTable.Cell>
          </DataTable.Row>
        {:else}
          <DataTable.EmptyRow columns={3} title="Nothing Booked For This Event" />
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  </LoadingRegion>
{/if}

<ActionDialog
  bind:open={bookOpen}
  heading="Book a Room"
  commitLabel="Book"
  commitBusyLabel="Booking"
  commitRefusal={bookRefusal}
  unsavedChanges={bookResourceId !== ""}
  onCommit={commitBook}
>
  {#snippet notice()}
    {#if bookFailure !== null}
      <FailureNotice
        failure={bookFailure.failure}
        title="The Booking Was Not Made"
        fallback={bookFailure.fallback}
        whenSilent={bookFailure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-16">
      <p class="text-sm text-text-muted">
        The booking takes this event's own window. A resource already taken is booked anyway and the
        double-booking is reported, never refused.
      </p>
      <div class="flex flex-col gap-4">
        <Label for="{idPrefix}-book-resource">Resource</Label>
        {#if bookableResources.length === 0}
          <p class="text-sm text-text-muted">
            The firm has no rooms or resources yet. They are added under Settings › Practice › Rooms
            and Resources.
          </p>
        {:else}
          <Select.Root
            type="single"
            items={bookableResources}
            bind:value={bookResourceId}
            allowDeselect={false}
          >
            <Select.Trigger id="{idPrefix}-book-resource" class="w-full">
              <Select.Value placeholder={placeholderOf("Resource")} />
            </Select.Trigger>
            <Select.Content>
              {#each bookableResources as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
        {/if}
      </div>
    </div>
  {/snippet}
</ActionDialog>
