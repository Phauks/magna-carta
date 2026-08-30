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
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Skeleton from "@magna-carta/design-system/skeleton";
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
  let readFailure = $state<string | null>(null);
  let reloadToken = $state(0);

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    names = null;
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryNames(fetch, id);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        names = outcome.value.data;
        return;
      }
      names = [];
      readFailure =
        outcome.kind === "transport"
          ? "Nothing answered. The names on this record could not be read."
          : (outcome.problem.detail ?? "The names on this record could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

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
  let submitting = $state(false);
  let failure = $state<string | null>(null);

  const ready = $derived(
    kind === "person" ? given.trim() !== "" && family.trim() !== "" : legalName.trim() !== "",
  );

  function reset(): void {
    role = kind === "person" ? "former" : "dba";
    prefix = "";
    given = "";
    middle = "";
    family = "";
    suffix = "";
    legalName = "";
    failure = null;
  }

  // The change dialog opens on the name the record carries NOW, because a name change is usually an
  // edit of one part — a surname — and retyping the rest is how the other parts get lost.
  function seedFromCurrent(): void {
    failure = null;
    if (entity.kind === "person") {
      prefix = entity.person.prefix ?? "";
      given = entity.person.given ?? "";
      middle = entity.person.middle ?? "";
      family = entity.person.family ?? "";
      suffix = entity.person.suffix ?? "";
    } else {
      legalName = entity.organization.legalName ?? "";
    }
  }

  function personFields() {
    return {
      given: given.trim(),
      family: family.trim(),
      prefix: prefix.trim() === "" ? null : prefix.trim(),
      middle: middle.trim() === "" ? null : middle.trim(),
      suffix: suffix.trim() === "" ? null : suffix.trim(),
    };
  }

  async function submitAdd(): Promise<void> {
    if (!ready || submitting) return;
    submitting = true;
    failure = null;
    const outcome = await addDirectoryName(
      fetch,
      entityId,
      kind === "person"
        ? { nameRole: role, ...personFields() }
        : { nameRole: role, legalName: legalName.trim() },
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      reset();
      addOpen = false;
      recorded();
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The name was not recorded."
        : (outcome.problem.detail ?? "The name could not be recorded.");
  }

  // ---- changing the name on the record ---------------------------------------------------------

  let changeOpen = $state(false);

  async function submitChange(): Promise<void> {
    if (!ready || submitting) return;
    submitting = true;
    failure = null;
    const outcome = await changeDirectoryName(
      fetch,
      entityId,
      kind === "person" ? personFields() : { legalName: legalName.trim() },
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      reset();
      changeOpen = false;
      recorded();
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The name on the record is unchanged."
        : (outcome.problem.detail ?? "The name could not be changed.");
  }
</script>

{#snippet personNameFields(idPrefix: string)}
  <div class="grid grid-cols-2 gap-16">
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-prefix">Prefix</Label>
      <Input id="{idPrefix}-prefix" bind:value={prefix} placeholder={placeholderOf("Prefix")} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-suffix">Suffix</Label>
      <Input id="{idPrefix}-suffix" bind:value={suffix} placeholder={placeholderOf("Suffix")} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-given">Given name</Label>
      <Input id="{idPrefix}-given" bind:value={given} placeholder={placeholderOf("Given name")} />
    </div>
    <div class="flex flex-col gap-8">
      <Label for="{idPrefix}-middle">Middle name</Label>
      <Input id="{idPrefix}-middle" bind:value={middle} placeholder={placeholderOf("Middle name")} />
    </div>
    <div class="col-span-2 flex flex-col gap-8">
      <Label for="{idPrefix}-family">Family name</Label>
      <Input id="{idPrefix}-family" bind:value={family} placeholder={placeholderOf("Family name")} />
    </div>
  </div>
{/snippet}

<section class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16">
    <h3 class="text-sm font-semibold">Names on the record</h3>
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

  {#if readFailure !== null}
    <Alert.Root variant="danger">
      <Alert.Title>The Names Could Not Be Read</Alert.Title>
      <Alert.Description>{readFailure}</Alert.Description>
    </Alert.Root>
  {:else if names === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading the names on this record">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if names.length === 0}
    <EmptyState title="No Names On This Record">
      Every record carries at least the name it was created under, so an empty list here means the
      record's name rows could not be found.
    </EmptyState>
  {:else}
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
        {#each names as entry (entry.id)}
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
        {/each}
      </DataTable.Body>
    </DataTable.Root>
  {/if}
</section>

<Dialog.Root bind:open={changeOpen}>
  <Dialog.Content class="max-w-xl">
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Dialog.Title>Change The Name On The Record</Dialog.Title>
        <Dialog.Description>
          {currentName} will answer to the new name from now on. The name on file is not erased — it
          is kept as a former name, stamped with today's date, and still finds this record in a
          search or a conflicts check.
        </Dialog.Description>
      </div>

      {#if kind === "person"}
        {@render personNameFields("change-name")}
      {:else}
        <div class="flex flex-col gap-8">
          <Label for="change-name-legal-name">Name</Label>
          <Input
            id="change-name-legal-name"
            bind:value={legalName}
            placeholder={placeholderOf("Name")}
          />
        </div>
      {/if}

      {#if failure !== null}
        <Alert.Root variant="danger">
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}

      <div class="flex justify-end gap-8">
        <Dialog.Close
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={submitting}
        >
          Cancel
        </Dialog.Close>
        <Button variant="primary" disabled={!ready || submitting} onclick={submitChange}>
          {submitting ? "Changing" : "Change Name"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={addOpen}>
  <Dialog.Content class="max-w-xl">
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Dialog.Title>Record Another Name</Dialog.Title>
        <Dialog.Description>
          This adds a name {currentName} also answers to. It does not replace the name currently on
          the record.
        </Dialog.Description>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="add-name-role-label">Role</Label>
        <Select.Root type="single" items={roleItems} bind:value={role} allowDeselect={false}>
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

      {#if kind === "person"}
        {@render personNameFields("add-name")}
      {:else}
        <div class="flex flex-col gap-8">
          <Label for="add-name-legal-name">Name</Label>
          <Input
            id="add-name-legal-name"
            bind:value={legalName}
            placeholder={placeholderOf("Name")}
          />
        </div>
      {/if}

      {#if failure !== null}
        <Alert.Root variant="danger">
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}

      <div class="flex justify-end gap-8">
        <Dialog.Close
          class={buttonClasses({ variant: "secondary", size: "default" })}
          disabled={submitting}
        >
          Cancel
        </Dialog.Close>
        <Button variant="primary" disabled={!ready || submitting} onclick={submitAdd}>
          {submitting ? "Recording" : "Record Name"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
