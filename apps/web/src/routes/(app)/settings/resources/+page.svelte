<script lang="ts">
  /*
   * Settings · Rooms and Resources — the firm's bookable things, under Firm. A CATALOG page,
   * not a settings form: every act (add, change, retire) is asked for in the one panel and commits
   * against the resource routes at once, so the posture is "applies immediately" and nothing is
   * staged. A retired resource keeps its bookings and its history; it simply stops being offered.
   *
   * Edit is gated on the session's real `calendar:manage`, because the settings permission seam
   * is still a mock. A member without it reads the catalog as the same table without its verbs.
   *
   * THE CATALOG IS THE PRODUCT'S ONE TABLE (catalog-columns.ts declares its columns): it sorts,
   * filters from its headers, offers its column roster, resizes and counts itself. The grid is
   * re-created when the session lands, because the Actions column exists only for a member who
   * may act and the grid fixes its columns when it is made.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as DropdownMenu from "@magna-carta/design-system/dropdown-menu";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Textarea from "@magna-carta/design-system/textarea";
  import Ellipsis from "@lucide/svelte/icons/ellipsis";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
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
  import {
    CATALOG_ACTIONS_COLUMN_ID,
    resourceColumns,
    resourceStandingLabel,
  } from "$lib/settings/catalog-columns.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import {
    listLocations,
    readSession,
    type LocationSummary,
    type SessionBootstrap,
  } from "$lib/matters/matters-api.ts";

  /** The kinds as the field offers them, worded by the one label helper every surface uses. */
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

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await listResources(fetch, true);
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

  const locationNames = $derived(
    new Map(locations.map((location) => [location.id, location.name])),
  );

  const grid = $derived(
    DataTable.createDataTableGrid<FirmResource>({
      columns: () => resourceColumns(canEdit, locationNames),
      rows: () => resources ?? [],
      rowKey: (resource) => resource.id,
      itemNoun: { singular: "resource", plural: "resources" },
    }),
  );

  // ---- the one form, for adding and for changing ----------------------------------------------

  /** "No office" is a real choice, so the field offers it as a row; the request sends null for it. */
  const NO_OFFICE = "no-office";

  interface ResourceDraft {
    name: string;
    kind: FirmResourceKind;
    locationId: string;
    capacity: string;
    notes: string;
  }

  function emptyDraft(): ResourceDraft {
    return { name: "", kind: "room", locationId: NO_OFFICE, capacity: "", notes: "" };
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

  const officeChoices = $derived([
    { value: NO_OFFICE, label: "No office" },
    ...locations
      .filter((location) => location.status === "active")
      .map((location) => ({ value: location.id, label: location.name })),
  ]);

  function chooseKind(next: string): void {
    const kind = FIRM_RESOURCE_KINDS.find((candidate) => candidate === next);
    if (kind !== undefined) draft.kind = kind;
  }

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
      locationId: resource.locationId ?? NO_OFFICE,
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
      locationId: draft.locationId === NO_OFFICE ? null : draft.locationId,
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
      "Couldn't connect. Nothing changed. Try again.",
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
</script>

<svelte:head>
  <title>Rooms and Resources · Settings · Magna Carta</title>
</svelte:head>

{#snippet resourceCell({ row, column, text }: DataTable.GridCellContext<FirmResource>)}
  {#if column.id === "name"}
    <!-- A link buys the browser's own gestures; the row's own gesture still opens nothing here,
         because a resource's home is the room grid rather than a record of its own. -->
    <a class="underline underline-offset-2" href="/calendar/rooms?resource={row.id}">{row.name}</a>
  {:else if column.id === "standing"}
    <Badge variant={row.active ? "success" : "neutral"}>{resourceStandingLabel(row)}</Badge>
  {:else if column.id === CATALOG_ACTIONS_COLUMN_ID}
    <!-- One icon-sized trigger rather than a button per act: the column keeps one width whatever
         a row offers (Retire and Restore are different lengths), so nothing reflows as a resource
         changes standing or as more acts arrive. -->
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={buttonClasses({ variant: "ghost", size: "icon-sm" })}
        aria-label={`Actions for ${row.name}`}
      >
        <Ellipsis class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item onSelect={() => openEdit(row)}>Change</DropdownMenu.Item>
        <DropdownMenu.Item onSelect={() => void setActive(row, !row.active)}>
          {row.active ? "Retire" : "Restore"}
        </DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  {:else}
    {text}
  {/if}
{/snippet}

<SettingsMasthead
  sectionId="resources"
  title="Rooms and Resources"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    What the firm can book: conference rooms, pool cars, equipment. A booking always belongs to an
    event.
  </SettingsDescription>

  {#if actionFailure !== null}
    <FailureNotice failure={actionFailure.failure} fallback={actionFailure.fallback} />
  {/if}

  <SettingsPlate heading="The Catalog">
    {#if canEdit || grid.isFiltered}
      <div class="flex items-center justify-end gap-8 py-12">
        <DataTable.ClearFilters {grid} />
        {#if canEdit}
          <Button variant="primary" size="sm" onclick={openAdd}>Add a Resource</Button>
        {/if}
      </div>
    {/if}
    {#if readFailure !== null && resources === null}
      <FailureNotice
        failure={readFailure}
        title="The Resources Could Not Be Read"
        fallback="The firm's rooms and resources were not read."
        onRetry={() => void load()}
      />
    {:else}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Resources Were Not Re-read"
          fallback="The catalog was not read again. What is shown was read and stands."
          onRetry={() => void load()}
        />
      {/if}
      <DataTable.Grid
        {grid}
        caption="The firm's rooms and resources"
        cell={resourceCell}
        loading={resources === null}
        placeholderCount={3}
      >
      </DataTable.Grid>
      <DataTable.GridFooter {grid} />
    {/if}
    {#if capped}
      <SettingsPlateNote>Showing the first page of the firm's resources.</SettingsPlateNote>
    {/if}
  </SettingsPlate>
</SettingsScrollRegion>

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
        <ChoicePicker
          options={KINDS}
          inputId="resource-kind"
          label="Kind"
          bind:value={() => draft.kind, chooseKind}
        />
      </div>
      <div class="flex flex-col gap-4">
        <Label for="resource-office">Office</Label>
        <ChoicePicker
          options={officeChoices}
          inputId="resource-office"
          label="Office"
          bind:value={draft.locationId}
        />
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
