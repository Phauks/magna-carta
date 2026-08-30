<script lang="ts">
  /*
   * The names an entity has held.
   *
   * A person's name is not one string. People marry, people change their names, an old file names
   * somebody the firm now knows by something else, and a company trades under a name that is not
   * the one on its certificate. The firm records every one of them and matches on every one of
   * them, which is what lets a twenty-year-old file be tied to a living person.
   *
   * WHAT IS ON SCREEN AND WHAT IS NOT. The name the entity currently carries is on the record and is
   * shown. The earlier ones are recorded and cannot yet be read back: the firm's record exposes only
   * the current name, so this pane shows one row and says plainly that the rest are kept. It does
   * not show an empty table, because "this entity has only ever had one name" and "the other names
   * cannot be read" are different facts and a reader would act on them differently.
   *
   * Adding a name IS served, and adding one is the point: it is how the maiden name on the old file
   * gets onto the record that conflicts will match.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Badge from "@magna-carta/design-system/badge";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Plus from "@lucide/svelte/icons/plus";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import {
    addDirectoryName,
    type DirectoryEntityDetail,
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

  let open = $state(false);
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

  async function submit(): Promise<void> {
    if (!ready || submitting) return;
    submitting = true;
    failure = null;
    const outcome = await addDirectoryName(
      fetch,
      entityId,
      kind === "person"
        ? {
            nameRole: role,
            given: given.trim(),
            family: family.trim(),
            prefix: prefix.trim() === "" ? null : prefix.trim(),
            middle: middle.trim() === "" ? null : middle.trim(),
            suffix: suffix.trim() === "" ? null : suffix.trim(),
          }
        : { nameRole: role, legalName: legalName.trim() },
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      reset();
      open = false;
      onRecorded();
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. The name was not recorded."
        : (outcome.problem.detail ?? "The name could not be recorded.");
  }
</script>

<section class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16">
    <h3 class="text-sm font-semibold">Names on the record</h3>
    <Button
      variant="secondary"
      disabled={!mayEdit}
      title={editDisabledReason}
      onclick={() => {
        reset();
        open = true;
      }}
    >
      <Plus class="size-16" aria-hidden="true" />
      Record another name
    </Button>
  </div>

  <DataTable.Root>
    <DataTable.Caption class="sr-only">The names this record carries</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Name</DataTable.Head>
        <DataTable.Head>Role</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      <DataTable.Row>
        <DataTable.Cell>{currentName}</DataTable.Cell>
        <DataTable.Cell>
          <Badge variant="accent">{nameRoleLabel("current")}</Badge>
        </DataTable.Cell>
      </DataTable.Row>
    </DataTable.Body>
  </DataTable.Root>

  <!-- The standing rule for a capability the record does not serve yet: the anatomy is on screen,
       marked, and says what it waits on. Never omitted, never faked. -->
  <div class="flex items-center gap-8">
    <MaturityBadge stage="soon" />
    <p class="text-xs text-text-muted">
      Every other name this record carries is kept and is matched on. Reading them back waits on a
      read of an entity's recorded names.
    </p>
  </div>
</section>

<Dialog.Root bind:open>
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
        <Select.Root
          type="single"
          items={roleItems}
          bind:value={role}
          allowDeselect={false}
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

      {#if kind === "person"}
        <div class="grid grid-cols-2 gap-16">
          <div class="flex flex-col gap-8">
            <Label for="add-name-prefix">Prefix</Label>
            <Input id="add-name-prefix" bind:value={prefix} placeholder={placeholderOf("Prefix")} />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="add-name-suffix">Suffix</Label>
            <Input id="add-name-suffix" bind:value={suffix} placeholder={placeholderOf("Suffix")} />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="add-name-given">Given name</Label>
            <Input id="add-name-given" bind:value={given} placeholder={placeholderOf("Given name")} />
          </div>
          <div class="flex flex-col gap-8">
            <Label for="add-name-middle">Middle name</Label>
            <Input
              id="add-name-middle"
              bind:value={middle}
              placeholder={placeholderOf("Middle name")}
            />
          </div>
          <div class="col-span-2 flex flex-col gap-8">
            <Label for="add-name-family">Family name</Label>
            <Input
              id="add-name-family"
              bind:value={family}
              placeholder={placeholderOf("Family name")}
            />
          </div>
        </div>
      {:else}
        <div class="flex flex-col gap-8">
          <Label for="add-name-legal-name">Name</Label>
          <Input id="add-name-legal-name" bind:value={legalName} placeholder={placeholderOf("Name")} />
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
        <Button variant="primary" disabled={!ready || submitting} onclick={submit}>
          {submitting ? "Recording" : "Record Name"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
