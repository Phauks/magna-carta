<script lang="ts">
  /*
   * Settings · Rooms and Resources — the firm's bookable things, under Practice. A CATALOG page,
   * not a settings form: every act (add, change, retire) is asked for in the one panel and commits
   * against the resource routes at once, so the posture is "applies immediately" and nothing is
   * staged. A retired resource keeps its bookings and its history; it simply stops being offered.
   *
   * Edit is gated on the session's real `calendar:manage`, because the settings permission seam
   * is still a mock. A member without it reads the catalog as a plain table.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as Select from "@magna-carta/design-system/select";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import Textarea from "@magna-carta/design-system/textarea";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { Failure } from "$lib/api/request.ts";
  import {
    createResource,
    FIRM_RESOURCE_KINDS,
    listResources,
    resourceKindLabel,
    updateResource,
    type FirmResource,
    type FirmResourceKind,
  } from "$lib/calendar/calendar-api.ts";
  import { mayManageCalendar } from "$lib/calendar/calendar-permission.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import {
    listLocations,
    readSession,
    type LocationSummary,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";

  /** The kinds as the select offers them, worded by the one label helper every surface uses. */
  const KINDS: readonly { value: FirmResourceKind; label: string }[] = FIRM_RESOURCE_KINDS.map(
    (kind) => ({ value: kind, label: resourceKindLabel(kind) }),
  );

  let session = $state<SessionBootstrap | null>(null);
  const canEdit = $derived(mayManageCalendar(session));

  let resources = $state<readonly FirmResource[] | null>(null);
  let capped = $state(false);
  let readFailure = $state<Failure | null>(null);
  let locations = $state<readonly LocationSummary[]>([]);
  let actionFailure = $state<StatedFailure | null>(null);
  /** True while the catalog is being read; a re-read keeps the rows on screen and says so. */
  let reading = $state(false);

  async function load(): Promise<void> {
    readFailure = null;
    reading = true;
    const outcome = await listResources(fetch, true);
    reading = false;
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    resources = outcome.value.data;
    capped = outcome.value.capped;
  }

  $effect(() => {
    void load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
    void listLocations(fetch).then((outcome) => {
      if (outcome.kind === "ok") locations = outcome.value.data;
    });
  });

  function locationName(locationId: string | null): string {
    if (locationId === null) return "";
    return locations.find((location) => location.id === locationId)?.name ?? "";
  }

  // ---- the one form, for adding and for changing ----------------------------------------------

  interface ResourceDraft {
    name: string;
    kind: FirmResourceKind;
    locationId: string;
    capacity: string;
    notes: string;
  }

  function emptyDraft(): ResourceDraft {
    return { name: "", kind: "room", locationId: "", capacity: "", notes: "" };
  }

  let formOpen = $state(false);
  let editing = $state<FirmResource | null>(null);
  let draft = $state<ResourceDraft>(emptyDraft());
  let since = $state<ResourceDraft>(emptyDraft());
  let formFailure = $state<StatedFailure | null>(null);
  let attemptKey: string | null = null;

  const capacityValue = $derived.by((): number | null | "invalid" => {
    const text = draft.capacity.trim();
    if (text === "") return null;
    const parsed = Number(text);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : "invalid";
  });
  const formRefusal = $derived.by((): string | undefined => {
    if (draft.name.trim() === "") return "Give it a name.";
    if (capacityValue === "invalid") return "Capacity is a whole number of seats, or blank.";
    return undefined;
  });
  const formStarted = $derived(JSON.stringify(draft) !== JSON.stringify(since));

  const officeItems = $derived(
    locations
      .filter((location) => location.status === "active")
      .map((location) => ({ value: location.id, label: location.name })),
  );

  function openAdd(): void {
    editing = null;
    draft = emptyDraft();
    since = emptyDraft();
    formFailure = null;
    attemptKey = null;
    formOpen = true;
  }

  function openEdit(resource: FirmResource): void {
    editing = resource;
    const seeded: ResourceDraft = {
      name: resource.name,
      kind: resource.kind,
      locationId: resource.locationId ?? "",
      capacity: resource.capacity === null ? "" : String(resource.capacity),
      notes: resource.notes ?? "",
    };
    draft = { ...seeded };
    since = { ...seeded };
    formFailure = null;
    attemptKey = null;
    formOpen = true;
  }

  async function commitForm(): Promise<ActionOutcome> {
    if (formRefusal !== undefined || capacityValue === "invalid") return "refused";
    formFailure = null;
    attemptKey ??= crypto.randomUUID();
    const request = {
      name: draft.name.trim(),
      kind: draft.kind,
      locationId: draft.locationId === "" ? null : draft.locationId,
      capacity: capacityValue,
      notes: draft.notes.trim() === "" ? null : draft.notes.trim(),
    };
    const outcome =
      editing === null
        ? await createResource(fetch, request, attemptKey)
        : await updateResource(fetch, editing.id, request, attemptKey);
    if (outcome.kind === "ok") {
      attemptKey = null;
      await load();
      return "committed";
    }
    if (outcome.kind === "problem") attemptKey = null;
    formFailure = stated(
      outcome.failure,
      editing === null ? "The resource was not added." : "The change was not saved.",
      "Nothing answered, so nothing changed; pressing again tries once more.",
    );
    return "refused";
  }

  /** Retire or restore: a retired resource stops being offered and keeps everything it had. */
  async function setActive(resource: FirmResource, active: boolean): Promise<void> {
    actionFailure = null;
    const outcome = await updateResource(fetch, resource.id, { active }, crypto.randomUUID());
    if (outcome.kind === "ok") {
      await load();
      return;
    }
    actionFailure = stated(
      outcome.failure,
      active ? "The resource was not restored." : "The resource was not retired.",
    );
  }

  // The shape drawn while the catalog is read: three rows in the table's own columns, sample words.
  // A resource's name, kind and office are the catalog's own kind of words, which the sample
  // vocabulary does not carry.
  const RESOURCE_FIXTURE = [
    { name: "Conference Room A", kind: "Room", office: "Downtown", seats: "12" },
    { name: "Pool Car 2", kind: "Vehicle", office: "Downtown", seats: "" },
    { name: "Video rig", kind: "Equipment", office: "Henderson", seats: "" },
  ] as const;
</script>

<svelte:head>
  <title>Rooms and Resources · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="resources"
  title="Rooms and Resources"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
  <SettingsDescription>What the firm can book: conference rooms, pool cars, equipment. A booking always belongs to an event.</SettingsDescription>

    {#if actionFailure !== null}
      <FailureNotice failure={actionFailure.failure} fallback={actionFailure.fallback} />
    {/if}

    <SettingsPlate heading="The Catalog">
      {#if canEdit}
        <div class="flex justify-end py-12">
          <Button variant="primary" size="sm" onclick={openAdd}>Add a Resource</Button>
        </div>
      {/if}
      <!-- A failed first read settles to the notice with Retry; a failed re-read after a commit
           keeps the rows on screen and says so above them. -->
      <LoadingRegion
        loading={resources === null}
        failed={readFailure !== null && resources === null}
        refreshing={reading}
        empty={resources !== null && resources.length === 0}
        label="Reading the resources"
        onRetry={() => void load()}
        class="flex flex-col"
      >
        {#snippet failure()}
          {#if readFailure !== null}
            <FailureNotice
              failure={readFailure}
              title="The Resources Could Not Be Read"
              fallback="The firm's rooms and resources were not read."
              onRetry={() => void load()}
            />
          {/if}
        {/snippet}
        {#snippet emptyState()}
          <EmptyState title="No rooms or resources yet">
            A resource is something bookable the firm owns. Add the first one and it can be booked
            from any event's window and read on the room grid.
          </EmptyState>
        {/snippet}
        {#snippet fixture()}
          <DataTable.Root>
            <DataTable.Header>
              <DataTable.Row>
                <DataTable.Head>Name</DataTable.Head>
                <DataTable.Head>Kind</DataTable.Head>
                <DataTable.Head>Office</DataTable.Head>
                <DataTable.Head class="text-end">Seats</DataTable.Head>
                <DataTable.Head>Standing</DataTable.Head>
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each RESOURCE_FIXTURE as row (row.name)}
                <DataTable.Row>
                  <DataTable.Cell>{row.name}</DataTable.Cell>
                  <DataTable.Cell>{row.kind}</DataTable.Cell>
                  <DataTable.Cell>{row.office}</DataTable.Cell>
                  <DataTable.Cell class="text-end tabular-nums">{row.seats}</DataTable.Cell>
                  <DataTable.Cell><Badge variant="success">Bookable</Badge></DataTable.Cell>
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
        {/snippet}
        {@const shown = resources ?? []}
        {#if readFailure !== null}
          <FailureNotice
            failure={readFailure}
            title="The Resources Were Not Re-read"
            fallback="The catalog was not read again. What is shown was read and stands."
            onRetry={() => void load()}
          />
        {/if}
        {#if shown.length > 0}
          <DataTable.Root>
            <DataTable.Caption class="sr-only">The firm's rooms and resources</DataTable.Caption>
            <DataTable.Header>
              <DataTable.Row>
                <DataTable.Head>Name</DataTable.Head>
                <DataTable.Head>Kind</DataTable.Head>
                <DataTable.Head>Office</DataTable.Head>
                <DataTable.Head class="text-end">Seats</DataTable.Head>
                <DataTable.Head>Standing</DataTable.Head>
                {#if canEdit}
                  <DataTable.Head class="sr-only">Actions</DataTable.Head>
                {/if}
              </DataTable.Row>
            </DataTable.Header>
            <DataTable.Body>
              {#each shown as resource (resource.id)}
                <DataTable.Row>
                  <DataTable.Cell>
                    <a class="underline underline-offset-2" href="/calendar/rooms?resource={resource.id}">
                      {resource.name}
                    </a>
                  </DataTable.Cell>
                  <DataTable.Cell>{resourceKindLabel(resource.kind)}</DataTable.Cell>
                  <DataTable.Cell>{locationName(resource.locationId)}</DataTable.Cell>
                  <DataTable.Cell class="text-end tabular-nums">
                    {resource.capacity === null ? "" : resource.capacity}
                  </DataTable.Cell>
                  <DataTable.Cell>
                    {#if resource.active}
                      <Badge variant="success">Bookable</Badge>
                    {:else}
                      <Badge variant="neutral">Retired</Badge>
                    {/if}
                  </DataTable.Cell>
                  {#if canEdit}
                    <DataTable.Cell class="text-end">
                      <Button variant="ghost" size="sm" onclick={() => openEdit(resource)}>Change</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onclick={() => void setActive(resource, !resource.active)}
                      >
                        {resource.active ? "Retire" : "Restore"}
                      </Button>
                    </DataTable.Cell>
                  {/if}
                </DataTable.Row>
              {/each}
            </DataTable.Body>
          </DataTable.Root>
          {#if capped}
            <p class="py-8 text-xs text-text-muted">Showing the first page of the firm's resources.</p>
          {/if}
        {/if}
      </LoadingRegion>
    </SettingsPlate>
  </div>
</div>

<ActionDialog
  bind:open={formOpen}
  heading={editing === null ? "Add a Resource" : "Change a Resource"}
  commitLabel={editing === null ? "Add Resource" : "Save Changes"}
  commitBusyLabel="Saving"
  commitRefusal={formRefusal}
  unsavedChanges={formStarted}
  onCommit={commitForm}
>
  {#snippet notice()}
    {#if formFailure !== null}
      <FailureNotice
        failure={formFailure.failure}
        fallback={formFailure.fallback}
        whenSilent={formFailure.whenSilent}
      />
    {/if}
  {/snippet}
  {#snippet fields()}
  <div class="flex flex-col gap-16">
    <div class="flex flex-col gap-4">
      <Label for="resource-name">Name</Label>
      <Input id="resource-name" bind:value={draft.name} />
    </div>
    <div class="flex flex-col gap-4">
      <Label for="resource-kind">Kind</Label>
      <Select.Root type="single" items={[...KINDS]} bind:value={draft.kind} allowDeselect={false}>
        <Select.Trigger id="resource-kind" class="w-full">
          <Select.Value placeholder="Kind" />
        </Select.Trigger>
        <Select.Content>
          {#each KINDS as kind (kind.value)}
            <Select.Item value={kind.value} label={kind.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-4">
      <Label for="resource-office">Office</Label>
      <Select.Root type="single" items={officeItems} bind:value={draft.locationId}>
        <Select.Trigger id="resource-office" class="w-full">
          <Select.Value placeholder="No office" />
        </Select.Trigger>
        <Select.Content>
          {#each officeItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>
    <div class="flex flex-col gap-4">
      <Label for="resource-capacity">Seats</Label>
      <Input id="resource-capacity" inputmode="numeric" bind:value={draft.capacity} />
    </div>
    <div class="flex flex-col gap-4">
      <Label for="resource-notes">Notes</Label>
      <Textarea id="resource-notes" class="resize-none" rows={3} bind:value={draft.notes} />
    </div>
  </div>
  {/snippet}
</ActionDialog>
