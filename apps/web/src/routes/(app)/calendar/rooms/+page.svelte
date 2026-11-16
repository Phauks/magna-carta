<script lang="ts">
  /*
   * The room grid: one bookable resource's schedule, a week at a time, over the availability read
   * with conflicts already paired. It is the one calendar component with the RESOURCE scope, and
   * nothing more: a room is busy only on account of a booking, a booking belongs to an event, and
   * activating a booking opens that event's window like everywhere else.
   *
   * WHICH RESOURCE IS ADDRESSABLE STATE, AND A DESTINATION. Another room is another schedule, so
   * choosing one NAVIGATES (a `goto` that replaces the entry, keeping focus and scroll), unlike
   * the view and the date, which the component mirrors as refinements with `replaceState`. The
   * two do not fight: a navigation lands `resource=` in the address before the component's own
   * mirror reads it, and the mirror leaves keys it does not own alone. Nothing here reads a
   * booking directly: the catalog is the only read this screen makes of its own, and it is what
   * names the room in the masthead.
   *
   * A firm with no resources yet is told where they are made (Settings › Practice › Rooms and
   * Resources) rather than shown an empty picker over an empty grid.
   */
  import { onMount, untrack } from "svelte";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import * as Select from "@magna-carta/design-system/select";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/request.ts";
  import {
    listResources,
    resourceChipLabel,
    resourceKindLabel,
    type FirmResource,
  } from "$lib/calendar/calendar-api.ts";
  import { CalendarView } from "$lib/calendar/index.ts";
  import type { CalendarViewKind } from "$lib/calendar/index.ts";
  import { todayCivil } from "$lib/calendar/calendar-window.ts";

  const RESOURCE_KEY = "resource";

  let resources = $state<readonly FirmResource[] | null>(null);
  let capped = $state(false);
  let readFailure = $state<Failure | null>(null);

  // Read once, on arrival: the address names the room; from there the picker owns the choice.
  let resourceId = $state<string | null>(untrack(() => page.url.searchParams.get(RESOURCE_KEY)));
  let view = $state<CalendarViewKind>("week");
  let anchor = $state(todayCivil());

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await listResources(fetch);
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    resources = outcome.value.data.filter((resource) => resource.active);
    capped = outcome.value.capped;
    // An address naming no room, or a room the catalog does not carry, opens on the first one.
    if (resourceId === null || !resources.some((resource) => resource.id === resourceId)) {
      resourceId = resources[0]?.id ?? null;
    }
  }

  onMount(() => {
    void load();
  });

  const resource = $derived(resources?.find((candidate) => candidate.id === resourceId) ?? null);
  const items = $derived(
    (resources ?? []).map((candidate) => ({
      value: candidate.id,
      label: resourceChipLabel(candidate),
    })),
  );

  /*
   * The room goes into the address as a navigation. Deferred past the first navigation so a
   * page arriving with no room named settles on the first one without racing hydration.
   */
  let navigated = $state(false);
  onMount(() => {
    const timer = setTimeout(() => {
      navigated = true;
    }, 0);
    return () => clearTimeout(timer);
  });
  $effect(() => {
    if (!navigated || resourceId === null) return;
    const url = new URL(page.url);
    if (url.searchParams.get(RESOURCE_KEY) === resourceId) return;
    url.searchParams.set(RESOURCE_KEY, resourceId);
    void goto(url, { replaceState: true, noScroll: true, keepFocus: true });
  });
</script>

<svelte:head><title>Rooms · Calendar · Magna Carta</title></svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <ScreenHeader
    title="Rooms"
    back="calendar"
  >
    {#snippet meta()}
      {#if resource !== null}
        <span>{resource.name}</span>
        <span>{resourceKindLabel(resource.kind)}</span>
        {#if resource.capacity !== null}
          <span>Seats {resource.capacity}</span>
        {/if}
      {/if}
    {/snippet}
    {#snippet actions()}
      {#if items.length > 0}
        <Select.Root
          type="single"
          items={items}
          bind:value={() => resourceId ?? "", (next) => (resourceId = next === "" ? null : next)}
          allowDeselect={false}
        >
          <Select.Trigger aria-label="Which resource" style="inline-size: var(--mc-size-popover)">
            <Select.Value placeholder={placeholderOf("Resource")} />
          </Select.Trigger>
          <Select.Content>
            {#each items as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      {/if}
      <Button variant="ghost" size="sm" href="/calendar">Calendar</Button>
    {/snippet}
  </ScreenHeader>

  <LoadingRegion
    loading={resources === null}
    failed={readFailure !== null}
    empty={resources !== null && resources.length === 0}
    label="Reading the firm's resources"
    onRetry={() => void load()}
    class="flex min-h-0 flex-1 flex-col gap-16"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="Couldn't Load the Resources"
          fallback="Couldn't load the firm's rooms and resources, so no schedule can be shown."
          onRetry={() => void load()}
        />
      {/if}
    {/snippet}
    {#snippet emptyState()}
      <EmptyState title="No rooms or resources yet">
        Resources are bookable things the firm owns, such as conference rooms, pool cars or video equipment. Add one under Settings to see its schedule here.
        {#snippet actions()}
          <Button variant="primary" href="/settings/resources">Rooms and Resources</Button>
        {/snippet}
      </EmptyState>
    {/snippet}
    <!-- Until the catalog names a room there is no schedule to draw, so the shape is the one
         block the week grid will fill: a second calendar drawn over sample bookings would be a
         second calendar. -->
    {#snippet fixture()}
      <div data-loading-block class="min-h-0 flex-1"></div>
    {/snippet}
    {#if resource !== null}
      {#if capped}
        <p class="text-xs text-text-muted">The picker lists the first page of the firm's resources.</p>
      {/if}
      {#key resource.id}
        <CalendarView
          scope={{ kind: "resource", resourceId: resource.id }}
          bind:view
          bind:anchor
          address
          class="min-h-0 flex-1"
        />
      {/key}
    {/if}
  </LoadingRegion>
</div>
