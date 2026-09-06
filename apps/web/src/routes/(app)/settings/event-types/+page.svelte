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
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  /** The categories as the select offers them, worded by the one label helper every surface uses. */
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
      "Nothing answered, so nothing changed; pressing again tries once more.",
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

  // The shape drawn while the catalog is read: three rows in the table's own columns, sample words.
  const TYPE_FIXTURE = [
    { name: "Hearing", code: "HRG", category: "Litigation", origin: "Platform" },
    { name: "Deposition", code: "DEPO", category: "Litigation", origin: "Platform" },
    { name: "Closing", code: "CLS", category: "Transaction", origin: "This firm" },
  ] as const;
</script>

<svelte:head>
  <title>Event Types · Settings · Magna Carta</title>
</svelte:head>

<SettingsMasthead
  sectionId="event-types"
  title="Event Types"
  meta="The words an event is classified under: the vocabulary the platform ships, and the firm's own."
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<div class="mc-scrollbar min-h-0 grow overflow-y-auto" style="scrollbar-gutter: stable">
  <div class="flex flex-col gap-24 p-24">
    {#if readFailure !== null}
      <FailureNotice
        failure={readFailure}
        title="The Event Types Could Not Be Read"
        fallback="The event-type catalog was not read."
        onRetry={() => void load()}
      />
    {/if}

    <SettingsPlate heading="The Vocabulary">
      {#if canEdit}
        <div class="flex justify-end py-12">
          <Button variant="primary" size="sm" onclick={openAdd}>Add an Event Type</Button>
        </div>
      {/if}
      {#if types !== null || readFailure === null}
        <LoadingRegion loading={types === null} label="Reading the event types" class="flex flex-col">
          {#snippet fixture()}
            <DataTable.Root>
              <DataTable.Header>
                <DataTable.Row>
                  <DataTable.Head>Name</DataTable.Head>
                  <DataTable.Head>Code</DataTable.Head>
                  <DataTable.Head>Category</DataTable.Head>
                  <DataTable.Head>Origin</DataTable.Head>
                  <DataTable.Head>Standing</DataTable.Head>
                </DataTable.Row>
              </DataTable.Header>
              <DataTable.Body>
                {#each TYPE_FIXTURE as row (row.name)}
                  <DataTable.Row>
                    <DataTable.Cell>{row.name}</DataTable.Cell>
                    <DataTable.Cell class="font-mono text-xs">{row.code}</DataTable.Cell>
                    <DataTable.Cell>{row.category}</DataTable.Cell>
                    <DataTable.Cell>{row.origin}</DataTable.Cell>
                    <DataTable.Cell><Badge variant="success">Offered</Badge></DataTable.Cell>
                  </DataTable.Row>
                {/each}
              </DataTable.Body>
            </DataTable.Root>
          {/snippet}
          {@const shown = types ?? []}
          {#if shown.length === 0}
            <EmptyState title="No event types">
              The platform's vocabulary arrives by migration; a firm adds its own words here.
            </EmptyState>
          {:else}
            <DataTable.Root>
              <DataTable.Caption class="sr-only">The event-type catalog</DataTable.Caption>
              <DataTable.Header>
                <DataTable.Row>
                  <DataTable.Head>Name</DataTable.Head>
                  <DataTable.Head>Code</DataTable.Head>
                  <DataTable.Head>Category</DataTable.Head>
                  <DataTable.Head>Origin</DataTable.Head>
                  <DataTable.Head>Standing</DataTable.Head>
                  {#if canEdit}
                    <DataTable.Head class="sr-only">Actions</DataTable.Head>
                  {/if}
                </DataTable.Row>
              </DataTable.Header>
              <DataTable.Body>
                {#each shown as type (type.id)}
                  <DataTable.Row>
                    <DataTable.Cell>{type.name}</DataTable.Cell>
                    <DataTable.Cell class="font-mono text-xs">{type.code ?? ""}</DataTable.Cell>
                    <DataTable.Cell>{eventTypeCategoryLabel(type.category)}</DataTable.Cell>
                    <DataTable.Cell>{type.origin === "platform" ? "Platform" : "This firm"}</DataTable.Cell>
                    <DataTable.Cell>
                      {#if type.active}
                        <Badge variant="success">Offered</Badge>
                      {:else}
                        <Badge variant="neutral">Retired</Badge>
                      {/if}
                    </DataTable.Cell>
                    {#if canEdit}
                      <DataTable.Cell class="text-end">
                        <Button variant="ghost" size="sm" onclick={() => openEdit(type)}>
                          {type.origin === "platform" ? "Recategorize" : "Change"}
                        </Button>
                        {#if type.active}
                          <Button variant="ghost" size="sm" onclick={() => openRetire(type)}>Retire</Button>
                        {/if}
                      </DataTable.Cell>
                    {/if}
                  </DataTable.Row>
                {/each}
              </DataTable.Body>
            </DataTable.Root>
            <p class="py-8 text-xs text-text-muted">
              A retired type keeps its meaning on every event already classified under it and is not
              offered for new ones. Retiring is one way: a word wanted back is added again as the firm's
              own.
            </p>
          {/if}
        </LoadingRegion>
      {/if}
    </SettingsPlate>
  </div>
</div>

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
          {editing.name} ships with the platform: its name and code are the shared vocabulary and
          stay as they are. Its category is the firm's to set.
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
            A short stable key the firm-wide calendar paints from, in capitals; optional.
          </p>
        </div>
      {/if}
      <div class="flex flex-col gap-4">
        <Label for="event-type-category">Category</Label>
        <Select.Root type="single" items={[...CATEGORIES]} bind:value={draft.category} allowDeselect={false}>
          <Select.Trigger id="event-type-category" class="w-full">
            <Select.Value placeholder="Category" />
          </Select.Trigger>
          <Select.Content>
            {#each CATEGORIES as category (category.value)}
              <Select.Item value={category.value} label={category.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </div>
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={retireOpen}
  kind="destructive"
  heading="Retire This Event Type?"
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
      {retiring?.name ?? "This type"} stops being offered for new events. Everything already
      classified under it keeps its meaning. Retiring is one way: a word wanted back later is added
      again as the firm's own.
    </p>
  {/snippet}
</ActionDialog>
