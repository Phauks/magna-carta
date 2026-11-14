<script lang="ts">
  /*
   * The names an entity has held.
   *
   * A person's name is not one string. People marry, people change their names, an old file names
   * somebody the firm now knows by something else, and a company trades under a name that is not
   * the one on its certificate. The firm records every one of them and matches on every one of
   * them, which is what lets a twenty-year-old file be tied to a living person.
   *
   * TWO ACTS, AND THEY ARE NOT THE SAME ACT. Changing the name replaces what the record answers to:
   * the old name is retained, stamped with the date it stopped being used, and stays in the search
   * and conflicts corpus with its phonetic codes intact. Recording another name adds one the entity
   * ALSO goes by, and touches the current one not at all. Offering one control for both is how a
   * maiden name ends up as somebody's current name.
   *
   * AN ORGANIZATION'S FORMER NAME READS LOWERCASE, and that is honest rather than broken: the firm's
   * name rows keep only the case-folded form the corpus indexes, so the alternative to showing it is
   * inventing a capitalization nobody recorded.
   */
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import * as Alert from "@magna-carta/design-system/alert";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldRow from "@magna-carta/design-system/field-row";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import HonorificField from "$lib/names/honorific-field.svelte";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import { sampleCivilDate, samplePerson } from "@magna-carta/design-system/loading-fixtures";
  import PenLine from "@lucide/svelte/icons/pen-line";
  import Plus from "@lucide/svelte/icons/plus";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import {
    addDirectoryName,
    changeDirectoryName,
    readDirectoryNames,
    type DirectoryEntityDetail,
    type DirectoryNameEntry,
    type DirectoryNameRole,
  } from "./directory-api.ts";
  import { appendableNameRoles, nameRoleLabel } from "./directory-vocabulary.ts";
  import { directoryEntityName, entityDetailIdentifier } from "./entity-presentation.ts";

  let {
    entity,
    mayEdit,
    editDisabledReason,
    onRecorded,
  }: {
    entity: DirectoryEntityDetail;
    mayEdit: boolean;
    editDisabledReason?: string;
    /** A name landed; the record is re-read so the current name on screen stays the record's. */
    onRecorded: () => void;
  } = $props();

  const kind = $derived(entity.kind);
  const entityId = $derived(entityDetailIdentifier(entity));
  const currentName = $derived(directoryEntityName(entity));
  const roleItems = $derived(
    appendableNameRoles(kind).map((entry) => ({ value: entry.role, label: entry.label })),
  );

  // ---- the rail ------------------------------------------------------------------------------

  let names = $state<readonly DirectoryNameEntry[] | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);
  /** True while names already on screen are being read again, after one was recorded. */
  let refreshing = $state(false);
  // The record whose names last landed. Only a change of RECORD discards what is on screen: a
  // re-read after a name lands keeps the rows where the reader is looking and marks the region
  // busy instead.
  let shownFor: string | null = null;

  /** One sample name as a name row: the display form and the case-folded form the corpus keeps. */
  function sampleNameRow(
    index: number,
  ): Pick<DirectoryNameEntry, "given" | "family" | "displayName" | "normalizedDisplay"> {
    const name = samplePerson(index).name;
    const [given = null, ...rest] = name.split(" ");
    return {
      given,
      family: rest.length === 0 ? null : rest.join(" "),
      displayName: name,
      normalizedDisplay: name.toLowerCase(),
    };
  }

  /**
   * The shape the rail takes while the record's names are being read: the current name and one
   * former name, in the same rows the real rail renders, over the sample vocabulary. The dates are
   * in the record's own stored shape, which the vocabulary does not carry.
   */
  const NAME_FIXTURE: readonly DirectoryNameEntry[] = [
    {
      id: "fixture-1",
      nameRole: "current",
      isCurrent: true,
      prefix: null,
      middle: null,
      suffix: null,
      ...sampleNameRow(0),
      validFrom: sampleCivilDate(2),
      validTo: null,
      recordedAt: "",
    },
    {
      id: "fixture-2",
      nameRole: "former",
      isCurrent: false,
      prefix: null,
      middle: null,
      suffix: null,
      ...sampleNameRow(2),
      validFrom: null,
      validTo: sampleCivilDate(2),
      recordedAt: "",
    },
  ];

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    if (shownFor === id) {
      refreshing = true;
    } else {
      names = null;
    }
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryNames(fetch, id);
      if (cancelled) return;
      refreshing = false;
      if (outcome.kind === "ok") {
        shownFor = id;
        names = outcome.value.data;
        return;
      }
      shownFor = null;
      names = [];
      readFailure = stated(outcome.failure, "Couldn't load the names on this record.");
    })();
    return () => {
      cancelled = true;
      refreshing = false;
    };
  });

  function retry(): void {
    reloadToken += 1;
  }

  /** What to print for one row: the recorded name, or the case-folded form where that is all there is. */
  function nameText(entry: DirectoryNameEntry): string {
    return entry.displayName ?? entry.normalizedDisplay;
  }

  /** The period a name was in use, as a person reads it. */
  function period(entry: DirectoryNameEntry): string {
    const from = entry.validFrom?.slice(0, 10) ?? null;
    const to = entry.validTo?.slice(0, 10) ?? null;
    if (from === null && to === null) return "—";
    if (to === null) return `From ${from ?? "—"}`;
    return `${from ?? "—"} to ${to}`;
  }

  function recorded(): void {
    reloadToken += 1;
    onRecorded();
  }

  // ---- recording another name ------------------------------------------------------------------

  let addOpen = $state(false);
  let role = $state<DirectoryNameRole>("former");
  let prefix = $state("");
  let given = $state("");
  let middle = $state("");
  let family = $state("");
  let suffix = $state("");
  let legalName = $state("");
  let writeFailure = $state<StatedFailure | null>(null);

  // A NAME, NOT TWO NAMES. A person with one name is an ordinary person, and a record that refuses
  // them files them under something they are not called. person-draft.ts holds the same rule for the
  // New Person panel; the missing last name is stated as a warning below, never as a refusal.
  const ready = $derived(kind === "person" ? given.trim() !== "" : legalName.trim() !== "");

  const refusal = $derived.by((): string | undefined => {
    if (ready) return undefined;
    return kind === "person" ? "A first name is required." : "A name is required.";
  });

  const warning = $derived(
    kind === "person" && given.trim() !== "" && family.trim() === ""
      ? "This name has no last name. The first name is used for searches and conflicts checks."
      : null,
  );

  /*
   * What the fields hold, as one string, so the guard can ask only when something has changed: the
   * add dialog against empty fields, the change dialog against the name it was seeded with.
   */
  const draft = $derived([prefix, given, middle, family, suffix, legalName].join("\u0000"));
  const EMPTY_DRAFT = ["", "", "", "", "", ""].join("\u0000");
  let seededDraft = $state(EMPTY_DRAFT);

  function reset(): void {
    role = kind === "person" ? "former" : "dba";
    prefix = "";
    given = "";
    middle = "";
    family = "";
    suffix = "";
    legalName = "";
    writeFailure = null;
  }

  // The change dialog opens on the name the record carries NOW, because a name change is usually an
  // edit of one part — a surname — and retyping the rest is how the other parts get lost.
  function seedFromCurrent(): void {
    writeFailure = null;
    if (entity.kind === "person") {
      prefix = entity.person.prefix ?? "";
      given = entity.person.given ?? "";
      middle = entity.person.middle ?? "";
      family = entity.person.family ?? "";
      suffix = entity.person.suffix ?? "";
    } else {
      legalName = entity.organization.legalName ?? "";
    }
    seededDraft = [prefix, given, middle, family, suffix, legalName].join("\u0000");
  }

  function personFields(): {
    given: string;
    family?: string;
    prefix: string | null;
    middle: string | null;
    suffix: string | null;
  } {
    const fields = {
      given: given.trim(),
      prefix: prefix.trim() === "" ? null : prefix.trim(),
      middle: middle.trim() === "" ? null : middle.trim(),
      suffix: suffix.trim() === "" ? null : suffix.trim(),
    };
    // Absent rather than empty: a person with one name has no family name, and the contract takes
    // an omitted field as "there is none" and an empty string as a value that cannot be one.
    return family.trim() === "" ? fields : { ...fields, family: family.trim() };
  }

  async function submitAdd(): Promise<ActionOutcome> {
    if (!ready) return "refused";
    writeFailure = null;
    const outcome = await addDirectoryName(
      fetch,
      entityId,
      kind === "person"
        ? { nameRole: role, ...personFields() }
        : { nameRole: role, legalName: legalName.trim() },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      recorded();
      return "committed";
    }
    writeFailure = stated(
      outcome.failure,
      "Couldn't save the name.",
      "The name wasn't saved.",
    );
    return "refused";
  }

  // ---- changing the name on the record ---------------------------------------------------------

  let changeOpen = $state(false);

  async function submitChange(): Promise<ActionOutcome> {
    if (!ready) return "refused";
    writeFailure = null;
    const outcome = await changeDirectoryName(
      fetch,
      entityId,
      kind === "person" ? personFields() : { legalName: legalName.trim() },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      recorded();
      return "committed";
    }
    writeFailure = stated(
      outcome.failure,
      "Couldn't change the name.",
      "The name on the record is unchanged.",
    );
    return "refused";
  }
</script>

{#snippet nameFields(busy: boolean)}
  {#if kind === "person"}
    <FieldRow>
      <LabelledField label="Prefix">
        {#snippet children({ props })}
          <HonorificField part="prefix" bind:value={prefix} disabled={busy} inputProps={props} />
        {/snippet}
      </LabelledField>
      <LabelledField label="Suffix">
        {#snippet children({ props })}
          <HonorificField part="suffix" bind:value={suffix} disabled={busy} inputProps={props} />
        {/snippet}
      </LabelledField>
    </FieldRow>
    <!-- The same words as the New Person panel: a name entered one way and corrected another is how
         a record ends up carrying two spellings of one convention. -->
    <FieldRow>
      <LabelledField label="First Name">
        {#snippet children({ props })}
          <Input
            {...props}
            disabled={busy}
            bind:value={given}
            placeholder={placeholderOf("First Name")}
          />
        {/snippet}
      </LabelledField>
      <LabelledField label="Middle Name">
        {#snippet children({ props })}
          <Input
            {...props}
            disabled={busy}
            bind:value={middle}
            placeholder={placeholderOf("Middle Name")}
          />
        {/snippet}
      </LabelledField>
    </FieldRow>
    <LabelledField label="Last Name">
      {#snippet children({ props })}
        <Input {...props} disabled={busy} bind:value={family} placeholder={placeholderOf("Last Name")} />
      {/snippet}
    </LabelledField>
    {#if warning !== null}
      <Alert.Root variant="warning">
        <Alert.Title>This Name Has No Last Name</Alert.Title>
        <Alert.Description>{warning}</Alert.Description>
      </Alert.Root>
    {/if}
  {:else}
    <LabelledField label="Name">
      {#snippet children({ props })}
        <Input {...props} disabled={busy} bind:value={legalName} placeholder={placeholderOf("Name")} />
      {/snippet}
    </LabelledField>
  {/if}
{/snippet}

<section class="flex flex-col gap-16">
  <!-- The section's heading is the record's own (record-sections.svelte); its acts stand here. -->
  <div class="flex items-center justify-end gap-16">
    <div class="flex items-center gap-8">
      <Button
        variant="secondary"
        disabled={!mayEdit}
        title={editDisabledReason}
        onclick={() => {
          reset();
          seedFromCurrent();
          changeOpen = true;
        }}
      >
        <PenLine class="size-16" aria-hidden="true" />
        Change the name
      </Button>
      <Button
        variant="secondary"
        disabled={!mayEdit}
        title={editDisabledReason}
        onclick={() => {
          reset();
          addOpen = true;
        }}
      >
        <Plus class="size-16" aria-hidden="true" />
        Record another name
      </Button>
    </div>
  </div>

  <LoadingRegion
    loading={names === null}
    {refreshing}
    failed={readFailure !== null}
    label="Reading the names on this record"
    onRetry={retry}
    class="flex flex-col gap-8"
  >
    {#snippet failure()}
      {#if readFailure !== null}
        <FailureNotice
          failure={readFailure.failure}
          title="Couldn't Load Names"
          fallback={readFailure.fallback}
          whenSilent={readFailure.whenSilent}
          onRetry={retry}
        />
      {/if}
    {/snippet}
    {#snippet fixture()}
      {@render nameTable(NAME_FIXTURE)}
    {/snippet}
    {@render nameTable(names ?? [])}
  </LoadingRegion>
</section>

<!-- One table for the rows, for the shape they take while they are read, and for the empty body
     they leave behind when there are none, so the three cannot drift. -->
{#snippet nameTable(rows: readonly DirectoryNameEntry[])}
  <DataTable.Root>
    <DataTable.Caption class="sr-only">The names this record carries</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Name</DataTable.Head>
        <DataTable.Head>Role</DataTable.Head>
        <DataTable.Head>In use</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each rows as entry (entry.id)}
        <DataTable.Row>
          <DataTable.Cell>{nameText(entry)}</DataTable.Cell>
          <DataTable.Cell>
            <Badge variant={entry.isCurrent ? "accent" : "neutral"}>
              {nameRoleLabel(entry.nameRole)}
            </Badge>
          </DataTable.Cell>
          <DataTable.Cell>
            <span class="text-text-muted">{period(entry)}</span>
          </DataTable.Cell>
        </DataTable.Row>
      {:else}
        <DataTable.EmptyRow columns={3} title="No Names On This Record" />
      {/each}
    </DataTable.Body>
  </DataTable.Root>
{/snippet}

<ActionDialog
  bind:open={changeOpen}
  kind="form"
  heading="Change the Name on the Record"
  subtitle={{ facts: [currentName] }}
  commitLabel="Change Name"
  commitBusyLabel="Changing"
  commitRefusal={refusal}
  unsavedChanges={draft !== seededDraft}
  onCommit={submitChange}
>
  {#snippet fields({ busy })}
    <!-- What the change does to the name already on file. It is about the act, so it sits with the
         fields the act happens in rather than in the line that names the record. -->
    <p class="text-xs text-text-muted">
      The current name is kept as a former name, dated today, and still finds this record in searches and conflicts checks.
    </p>

    {@render nameFields(busy)}
  {/snippet}

  {#snippet notice()}
    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure.failure}
        title="Name Not Saved"
        fallback={writeFailure.fallback}
        whenSilent={writeFailure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>

<ActionDialog
  bind:open={addOpen}
  kind="form"
  heading="Record Another Name"
  subtitle={{ facts: [currentName] }}
  commitLabel="Record Name"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  unsavedChanges={draft !== EMPTY_DRAFT}
  onCommit={submitAdd}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label id="add-name-role-label">Role</Label>
      <Select.Root
        type="single"
        items={roleItems}
        bind:value={role}
        allowDeselect={false}
        disabled={busy}
      >
        <Select.Trigger class="min-w-64" aria-labelledby="add-name-role-label">
          <Select.Value />
        </Select.Trigger>
        <Select.Content>
          {#each roleItems as item (item.value)}
            <Select.Item value={item.value} label={item.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </div>

    {@render nameFields(busy)}
  {/snippet}

  {#snippet notice()}
    {#if writeFailure !== null}
      <FailureNotice
        failure={writeFailure.failure}
        title="Name Not Saved"
        fallback={writeFailure.fallback}
        whenSilent={writeFailure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>
