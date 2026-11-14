<script lang="ts">
  /*
   * Settings · Event Types — the vocabulary an event is classified under, under Practice. A
   * CATALOG page on the Rooms and Resources pattern: each act commits through its own dialog
   * against the event-type routes at once, so the posture is "applies immediately".
   *
   * TWO ORIGINS, ONE LIST. A type the platform ships is the shared vocabulary: its name and code
   * are immutable to a firm, which may recategorize it or retire it and add words of its own. A
   * firm's own type can be renamed. Retiring is one way: nothing in the contract reactivates a
   * retired type, and the page says so rather than offering a control the route would refuse.
   *
   * THE CATALOG IS THE PRODUCT'S ONE TABLE. It sorts, filters from its headers, offers its column
   * roster, resizes and counts itself, because the grid supplies all of that from the column model
   * (catalog-columns.ts) — a register in Settings is not a lesser table than a register anywhere
   * else. The grid is re-created when the session lands, because the Actions column exists only
   * for a member who may act and the grid fixes its columns when it is made; nobody has sorted or
   * filtered anything by then.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { Failure } from "$lib/api/request.ts";
  import {
    createEventType,
    deactivateEventType,
    EVENT_TYPE_CATEGORIES,
    eventTypeCategoryLabel,
    listEventTypes,
    updateEventType,
    type EventType,
    type EventTypeCategory,
  } from "$lib/calendar/calendar-api.ts";
  import { mayManageCalendar } from "$lib/calendar/calendar-permission.ts";
  import {
    CATALOG_ACTIONS_COLUMN_ID,
    eventTypeColumns,
    eventTypeStandingLabel,
  } from "$lib/settings/catalog-columns.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  /** The categories as the field offers them, worded by the one label helper every surface uses. */
  const CATEGORIES: readonly { value: EventTypeCategory; label: string }[] =
    EVENT_TYPE_CATEGORIES.map((category) => ({
      value: category,
      label: eventTypeCategoryLabel(category),
    }));

  let session = $state<SessionBootstrap | null>(null);
  const canEdit = $derived(mayManageCalendar(session));

  let types = $state<readonly EventType[] | null>(null);
  let readFailure = $state<Failure | null>(null);

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await listEventTypes(fetch, true);
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    types = outcome.value.data;
  }

  $effect(() => {
    void load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });

  const grid = $derived(
    DataTable.createDataTableGrid<EventType>({
      columns: () => eventTypeColumns(canEdit),
      rows: () => types ?? [],
      rowKey: (type) => type.id,
      itemNoun: { singular: "event type", plural: "event types" },
    }),
  );

  // ---- the one form, for adding and for changing ----------------------------------------------

  interface TypeDraft {
    name: string;
    code: string;
    category: EventTypeCategory;
  }

  function emptyDraft(): TypeDraft {
    return { name: "", code: "", category: "litigation" };
  }

  let formOpen = $state(false);
  let editing = $state<EventType | null>(null);
  let draft = $state<TypeDraft>(emptyDraft());
  let since = $state<TypeDraft>(emptyDraft());
  let formFailure = $state<StatedFailure | null>(null);
  let attemptKey: string | null = null;

  /** A platform type's name and code are the shared vocabulary; only its category is the firm's. */
  const wordsLocked = $derived(editing !== null && editing.origin === "platform");
  const formRefusal = $derived.by((): string | undefined => {
    if (!wordsLocked && draft.name.trim() === "") return "Give it a name.";
    return undefined;
  });
  const formStarted = $derived(JSON.stringify(draft) !== JSON.stringify(since));

  function openAdd(): void {
    editing = null;
    draft = emptyDraft();
    since = emptyDraft();
    formFailure = null;
    attemptKey = null;
    formOpen = true;
  }

  function openEdit(type: EventType): void {
    editing = type;
    const seeded: TypeDraft = { name: type.name, code: type.code ?? "", category: type.category };
    draft = { ...seeded };
    since = { ...seeded };
    formFailure = null;
    attemptKey = null;
    formOpen = true;
  }

  function chooseCategory(next: string): void {
    const category = EVENT_TYPE_CATEGORIES.find((candidate) => candidate === next);
    if (category !== undefined) draft.category = category;
  }

  async function commitForm(): Promise<ActionOutcome> {
    if (formRefusal !== undefined) return "refused";
    formFailure = null;
    attemptKey ??= crypto.randomUUID();
    const outcome =
      editing === null
        ? await createEventType(
            fetch,
            {
              name: draft.name.trim(),
              code: draft.code.trim() === "" ? null : draft.code.trim().toUpperCase(),
              category: draft.category,
            },
            attemptKey,
          )
        : await updateEventType(
            fetch,
            editing.id,
            wordsLocked
              ? { category: draft.category }
              : {
                  name: draft.name.trim(),
                  code: draft.code.trim() === "" ? null : draft.code.trim().toUpperCase(),
                  category: draft.category,
                },
            attemptKey,
          );
    if (outcome.kind === "ok") {
      attemptKey = null;
      await load();
      return "committed";
    }
    if (outcome.kind === "problem") attemptKey = null;
    formFailure = stated(
      outcome.failure,
      editing === null ? "The event type was not added." : "The change was not saved.",
      "Couldn't connect. Nothing changed. Try again.",
    );
    return "refused";
  }

  /*
   * RETIRING IS ASKED, NOT CLICKED. It is one way (events already classified keep their meaning,
   * the word stops being offered, and nothing brings it back), so the row's control opens a
   * destructive question and the question commits.
   */
  let retiring = $state<EventType | null>(null);
  let retireOpen = $state(false);
  let retireFailure = $state<StatedFailure | null>(null);

  function openRetire(type: EventType): void {
    retiring = type;
    retireFailure = null;
    retireOpen = true;
  }

  async function commitRetire(): Promise<ActionOutcome> {
    if (retiring === null) return "refused";
    retireFailure = null;
    const outcome = await deactivateEventType(fetch, retiring.id, crypto.randomUUID());
    if (outcome.kind === "ok") {
      await load();
      return "committed";
    }
    retireFailure = stated(outcome.failure, "The event type was not retired.");
    return "refused";
  }
</script>

<svelte:head>
  <title>Event Types · Settings · Magna Carta</title>
</svelte:head>

{#snippet typeCell({ row, column, text }: DataTable.GridCellContext<EventType>)}
  {#if column.id === "code"}
    <span class="font-mono text-xs">{text}</span>
  {:else if column.id === "standing"}
    <Badge variant={row.active ? "success" : "neutral"}>{eventTypeStandingLabel(row)}</Badge>
  {:else if column.id === CATALOG_ACTIONS_COLUMN_ID}
    <span class="inline-flex items-center justify-end gap-4">
      <Button variant="ghost" size="sm" onclick={() => openEdit(row)}>
        {row.origin === "platform" ? "Recategorize" : "Change"}
      </Button>
      {#if row.active}
        <Button variant="ghost" size="sm" onclick={() => openRetire(row)}>Retire</Button>
      {/if}
    </span>
  {:else}
    {text}
  {/if}
{/snippet}

<SettingsMasthead
  sectionId="event-types"
  title="Event Types"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The event types the firm uses, both built-in and the firm's own.
  </SettingsDescription>

  <SettingsPlate heading="The Vocabulary">
    <!-- The row above the table renders only when something has to be in it: the way out of a
         filter, and the act that adds a word. -->
    {#if canEdit || grid.isFiltered}
      <div class="flex items-center justify-end gap-8 py-12">
        <DataTable.ClearFilters {grid} />
        {#if canEdit}
          <Button variant="primary" size="sm" onclick={openAdd}>Add an Event Type</Button>
        {/if}
      </div>
    {/if}
    {#if readFailure !== null && types === null}
      <FailureNotice
        failure={readFailure}
        title="The Event Types Could Not Be Read"
        fallback="The event-type catalog was not read."
        onRetry={() => void load()}
      />
    {:else}
      {#if readFailure !== null}
        <!-- A failed re-read after a commit keeps the rows on screen and says so above them. -->
        <FailureNotice
          failure={readFailure}
          title="The Event Types Were Not Re-read"
          fallback="The catalog was not read again. What is shown was read and stands."
          onRetry={() => void load()}
        />
      {/if}
      <DataTable.Grid
        {grid}
        caption="The event-type catalog"
        cell={typeCell}
        loading={types === null}
        placeholderCount={3}
      >
      </DataTable.Grid>
      <DataTable.GridFooter {grid} />
    {/if}
    <SettingsPlateNote>
      A retired type stays on events that already use it but isn't offered for new ones. It can't be un-retired; add it again as a new type instead.
    </SettingsPlateNote>
  </SettingsPlate>
</SettingsScrollRegion>

<ActionDialog
  bind:open={formOpen}
  heading={editing === null
    ? "Add an Event Type"
    : wordsLocked
      ? "Recategorize an Event Type"
      : "Change an Event Type"}
  commitLabel={editing === null ? "Add Event Type" : "Save Changes"}
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
      {#if wordsLocked && editing !== null}
        <p class="text-sm text-text-muted">
          {editing.name} is built in, so its name and code can't change. You can set its category.
        </p>
      {:else}
        <div class="flex flex-col gap-4">
          <Label for="event-type-name">Name</Label>
          <Input id="event-type-name" bind:value={draft.name} />
        </div>
        <div class="flex flex-col gap-4">
          <Label for="event-type-code">Code</Label>
          <Input id="event-type-code" autocapitalize="characters" bind:value={draft.code} />
          <p class="text-xs text-text-muted">
            A short code in capitals, used for calendar colors. Optional.
          </p>
        </div>
      {/if}
      <div class="flex flex-col gap-4">
        <Label for="event-type-category">Category</Label>
        <ChoicePicker
          options={CATEGORIES}
          inputId="event-type-category"
          label="Category"
          bind:value={() => draft.category, chooseCategory}
        />
      </div>
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={retireOpen}
  kind="destructive"
  heading="Retire This Event Type"
  commitLabel="Retire the Event Type"
  commitBusyLabel="Retiring"
  unsavedChanges={false}
  onCommit={commitRetire}
>
  {#snippet notice()}
    {#if retireFailure !== null}
      <FailureNotice failure={retireFailure.failure} fallback={retireFailure.fallback} />
    {/if}
  {/snippet}
  {#snippet fields()}
    <p class="text-sm text-text-muted">
      {retiring?.name ?? "This type"} won't be offered for new events. Existing events keep it. It can't be un-retired; add it again as a new type instead.
    </p>
  {/snippet}
</ActionDialog>
