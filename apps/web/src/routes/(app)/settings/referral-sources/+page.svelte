<script lang="ts">
  /*
   * Settings · Referral Sources — the list a client's Source is picked from, under Practice. A
   * CATALOG page on the Event Types pattern: each act commits against the referral-source routes
   * at once, so the posture is "applies immediately".
   *
   * THE FIRM'S OWN LIST, SEEDED. It arrives with a starting set (Past Client, Another Attorney,
   * Website and so on) the firm renames, reorders, retires and adds to. Retiring is not deleting:
   * clients already recorded under a source keep it, and it stops being offered for new ones. So a
   * retired source can be restored, and retiring is a plain press rather than a question.
   *
   * THE ORDER IS THE FIELD'S ORDER. Move Up and Move Down change where a source sits in the Source
   * field, one place at a time.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { failureToast } from "$lib/diagnostics/failure-toast.ts";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { Failure } from "$lib/api/request.ts";
  import { DIRECTORY_EDIT_PERMISSION } from "$lib/directory/directory-api.ts";
  import {
    createReferralSource,
    listReferralSources,
    updateReferralSource,
    type ReferralSource,
  } from "$lib/directory/referral-api.ts";
  import {
    CATALOG_ACTIONS_COLUMN_ID,
    referralSourceColumns,
    referralSourceStandingLabel,
  } from "$lib/settings/catalog-columns.ts";
  import SettingsDescription from "$lib/settings/components/settings-description.svelte";
  import SettingsMasthead from "$lib/settings/components/settings-masthead.svelte";
  import SettingsPlate from "$lib/settings/components/settings-plate.svelte";
  import SettingsPlateNote from "$lib/settings/components/settings-plate-note.svelte";
  import SettingsScrollRegion from "$lib/settings/components/settings-scroll-region.svelte";
  import { readSession, type SessionBootstrap } from "$lib/matters/matters-api.ts";

  let session = $state<SessionBootstrap | null>(null);
  const canEdit = $derived(session?.permissions.includes(DIRECTORY_EDIT_PERMISSION) ?? false);

  let sources = $state<readonly ReferralSource[] | null>(null);
  let readFailure = $state<Failure | null>(null);
  /** The source a row act is working on, so its buttons wait. */
  let working = $state<string | null>(null);

  async function load(): Promise<void> {
    readFailure = null;
    const outcome = await listReferralSources(fetch);
    if (outcome.kind !== "ok") {
      readFailure = outcome.failure;
      return;
    }
    sources = outcome.value.data;
  }

  $effect(() => {
    void load();
    void readSession(fetch).then((outcome) => {
      if (outcome.kind === "ok") session = outcome.value;
    });
  });

  const grid = $derived(
    DataTable.createDataTableGrid<ReferralSource>({
      columns: () => referralSourceColumns(canEdit),
      rows: () => sources ?? [],
      rowKey: (source) => source.id,
      // The firm's own order, the way the Source field offers the list.
      initialSort: { columnId: "order", direction: "ascending" },
      itemNoun: { singular: "source", plural: "sources" },
    }),
  );

  // ---- the one form, for adding and for renaming -----------------------------------------------

  let formOpen = $state(false);
  let renaming = $state<ReferralSource | null>(null);
  let name = $state("");
  let formFailure = $state<StatedFailure | null>(null);
  let attemptKey: string | null = null;

  const formRefusal = $derived(name.trim() === "" ? "Give it a name." : undefined);
  const formStarted = $derived(name.trim() !== (renaming?.name ?? ""));

  function openAdd(): void {
    renaming = null;
    name = "";
    formFailure = null;
    attemptKey = null;
    formOpen = true;
  }

  function openRename(source: ReferralSource): void {
    renaming = source;
    name = source.name;
    formFailure = null;
    attemptKey = null;
    formOpen = true;
  }

  async function commitForm(): Promise<ActionOutcome> {
    if (formRefusal !== undefined) return "refused";
    formFailure = null;
    attemptKey ??= crypto.randomUUID();
    const outcome =
      renaming === null
        ? await createReferralSource(fetch, { name: name.trim() }, attemptKey)
        : await updateReferralSource(fetch, renaming.id, { name: name.trim() }, attemptKey);
    if (outcome.kind === "ok") {
      attemptKey = null;
      await load();
      return "committed";
    }
    if (outcome.kind === "problem") attemptKey = null;
    formFailure = stated(
      outcome.failure,
      renaming === null ? "The source was not added." : "The change wasn't saved.",
      "Couldn't connect. Nothing changed. Try again.",
    );
    return "refused";
  }

  // ---- the row acts, each applying at once ------------------------------------------------------

  async function change(
    source: ReferralSource,
    request: { position?: number; archived?: boolean },
    failed: string,
  ): Promise<void> {
    working = source.id;
    const outcome = await updateReferralSource(fetch, source.id, request, crypto.randomUUID());
    working = null;
    if (outcome.kind !== "ok") {
      failureToast(outcome.failure, failed);
      return;
    }
    await load();
  }

  const lastPosition = $derived((sources?.length ?? 1) - 1);
</script>

<svelte:head>
  <title>Referral Sources · Settings · Magna Carta</title>
</svelte:head>

{#snippet sourceCell({ row, column, text }: DataTable.GridCellContext<ReferralSource>)}
  {#if column.id === "standing"}
    <Badge variant={row.archived ? "neutral" : "success"}>{referralSourceStandingLabel(row)}</Badge>
  {:else if column.id === CATALOG_ACTIONS_COLUMN_ID}
    <span class="inline-flex items-center justify-end gap-4">
      <Button
        variant="ghost"
        size="sm"
        disabled={working !== null || row.position === 0}
        onclick={() => void change(row, { position: row.position - 1 }, "The source wasn't moved.")}
      >
        Move Up
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={working !== null || row.position >= lastPosition}
        onclick={() => void change(row, { position: row.position + 1 }, "The source wasn't moved.")}
      >
        Move Down
      </Button>
      <Button variant="ghost" size="sm" disabled={working !== null} onclick={() => openRename(row)}>
        Rename
      </Button>
      <Button
        variant="ghost"
        size="sm"
        disabled={working !== null}
        onclick={() =>
          void change(
            row,
            { archived: !row.archived },
            row.archived ? "The source wasn't restored." : "The source wasn't retired.",
          )}
      >
        {row.archived ? "Restore" : "Retire"}
      </Button>
    </span>
  {:else}
    {text}
  {/if}
{/snippet}

<SettingsMasthead
  sectionId="referral-sources"
  title="Referral Sources"
  posture={canEdit ? "instant" : "readOnly"}
  showHistory={false}
/>

<SettingsScrollRegion>
  <SettingsDescription>
    The list a client's Source is picked from, in the order it is offered.
  </SettingsDescription>

  <SettingsPlate heading="The List">
    {#if canEdit || grid.isFiltered}
      <div class="flex items-center justify-end gap-8 py-12">
        <DataTable.ClearFilters {grid} />
        {#if canEdit}
          <Button variant="primary" size="sm" onclick={openAdd}>Add a Source</Button>
        {/if}
      </div>
    {/if}
    {#if readFailure !== null && sources === null}
      <FailureNotice
        failure={readFailure}
        title="The Referral Sources Could Not Be Read"
        fallback="The list of referral sources was not read."
        onRetry={() => void load()}
      />
    {:else}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure}
          title="The Referral Sources Were Not Re-read"
          fallback="The list was not read again. What is shown was read and stands."
          onRetry={() => void load()}
        />
      {/if}
      <DataTable.Grid
        {grid}
        caption="The firm's referral sources"
        cell={sourceCell}
        loading={sources === null}
        placeholderCount={4}
      >
      </DataTable.Grid>
      <DataTable.GridFooter {grid} />
    {/if}
    <SettingsPlateNote>
      A retired source stays on the clients already recorded under it but isn't offered for new ones. Restore it to offer it again.
    </SettingsPlateNote>
  </SettingsPlate>
</SettingsScrollRegion>

<ActionDialog
  bind:open={formOpen}
  heading={renaming === null ? "Add a Source" : "Rename a Source"}
  commitLabel={renaming === null ? "Add Source" : "Save"}
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
    <LabelledField necessity="required" label="Name">
      {#snippet children({ props })}
        <Input {...props} bind:value={name} />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
