<script lang="ts">
  /*
   * The sealed identifiers the firm holds for an entity.
   *
   * These are the values a directory is trusted with and a firm is sued over: a social security
   * number, a tax number, a licence, an account. None of them is stored in the clear. What the firm
   * keeps is the sealed value and, for the types whose entropy allows it, an exact-match index that
   * lets a conflicts check say "these are the same person" without ever decrypting anything.
   *
   * SO THIS PANE CANNOT LIST THEM, AND THAT IS BY DESIGN. There is no reading of an entity's
   * identifiers as a set: a value is asked for one type at a time, the ask is refused without the
   * permission, and the firm's audit log records who asked before any plaintext exists. Showing the
   * types the record CAN hold, each with its own reveal, is the honest shape — it never guesses at
   * what is there, and it never reads seven values to render a table nobody asked for.
   *
   * A revealed value that comes back empty means the firm holds none of that type. That answer is
   * distinct from a refusal and is shown as its own thing.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button, { buttonClasses } from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Plus from "@lucide/svelte/icons/plus";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import {
    addDirectoryIdentifier,
    readDirectoryIdentifier,
    type DirectoryEntityKind,
    type DirectoryIdentifierType,
  } from "./directory-api.ts";
  import { identifierTypesFor } from "./directory-vocabulary.ts";

  let {
    entityId,
    kind,
    mayEdit,
    editDisabledReason,
    mayReveal,
    revealDisabledReason,
  }: {
    entityId: string;
    kind: DirectoryEntityKind;
    mayEdit: boolean;
    editDisabledReason?: string;
    mayReveal: boolean;
    revealDisabledReason?: string;
  } = $props();

  const types = $derived(identifierTypesFor(kind));

  /** What has been asked for, per type. Nothing is asked until somebody asks. */
  type RevealState =
    | { phase: "sealed" }
    | { phase: "reading" }
    | { phase: "shown"; value: string }
    | { phase: "hidden"; value: string }
    | { phase: "none" }
    | { phase: "refused"; message: string };

  let reveals = $state<Record<string, RevealState>>({});
  let shownFor = $state<string | null>(null);

  // A different entity's values are a different entity's business: nothing carries across.
  $effect(() => {
    if (shownFor === entityId) return;
    shownFor = entityId;
    reveals = {};
  });

  function stateOf(type: DirectoryIdentifierType): RevealState {
    return reveals[type] ?? { phase: "sealed" };
  }

  async function reveal(type: DirectoryIdentifierType): Promise<void> {
    const current = stateOf(type);
    if (current.phase === "reading") return;
    if (current.phase === "shown") {
      // Hiding again is a screen act, not a second read: the one recorded read already happened.
      reveals = { ...reveals, [type]: { phase: "hidden", value: current.value } };
      return;
    }
    if (current.phase === "hidden") {
      reveals = { ...reveals, [type]: { phase: "shown", value: current.value } };
      return;
    }
    reveals = { ...reveals, [type]: { phase: "reading" } };
    const outcome = await readDirectoryIdentifier(fetch, entityId, type);
    if (outcome.kind === "ok") {
      reveals = {
        ...reveals,
        [type]:
          outcome.value.value === null
            ? { phase: "none" }
            : { phase: "shown", value: outcome.value.value },
      };
      return;
    }
    reveals = {
      ...reveals,
      [type]: {
        phase: "refused",
        message:
          outcome.kind === "transport"
            ? "Nothing answered."
            : (outcome.problem.detail ?? "The value could not be read."),
      },
    };
  }

  // ---- recording a value --------------------------------------------------------------------

  let open = $state(false);
  // Defaulted to a type BOTH kinds can hold, so the initial value never references the
  // kind-filtered list and never has to be corrected after the fact.
  let newType = $state<DirectoryIdentifierType>("account");
  let newValue = $state("");
  let submitting = $state(false);
  let failure = $state<string | null>(null);

  const typeItems = $derived(
    types.map((entry) => ({ value: entry.type, label: entry.label })),
  );

  async function submit(): Promise<void> {
    if (newValue.trim() === "" || submitting) return;
    submitting = true;
    failure = null;
    const outcome = await addDirectoryIdentifier(
      fetch,
      entityId,
      { type: newType, value: newValue.trim() },
      crypto.randomUUID(),
    );
    submitting = false;
    if (outcome.kind === "ok") {
      // The stored value is sealed on arrival, so what was typed is discarded here too: the pane
      // never keeps a plaintext copy of something it just sealed.
      newValue = "";
      reveals = { ...reveals, [newType]: { phase: "sealed" } };
      open = false;
      return;
    }
    failure =
      outcome.kind === "transport"
        ? "Nothing answered. Nothing was sealed."
        : (outcome.problem.detail ?? "The identifier could not be recorded.");
  }
</script>

<section class="flex flex-col gap-16">
  <div class="flex items-center justify-between gap-16">
    <h3 class="text-sm font-semibold">Identifiers</h3>
    <Button
      variant="secondary"
      disabled={!mayEdit}
      title={editDisabledReason}
      onclick={() => {
        failure = null;
        open = true;
      }}
    >
      <Plus class="size-16" aria-hidden="true" />
      Record an identifier
    </Button>
  </div>

  <!-- Said once, above the controls, because it governs every one of them and a person has to know
       it BEFORE they press: reading a sealed value is recorded against their name. -->
  <p class="flex items-center gap-8 text-xs text-text-muted">
    <ShieldCheck class="size-16" aria-hidden="true" />
    Values are sealed under the firm's key. Revealing one is recorded in the firm's audit log.
  </p>

  <DataTable.Root>
    <DataTable.Caption class="sr-only">The identifier types this record can hold</DataTable.Caption>
    <DataTable.Header>
      <DataTable.Row>
        <DataTable.Head>Type</DataTable.Head>
        <DataTable.Head>Value</DataTable.Head>
        <DataTable.Head data-align="end">Reveal</DataTable.Head>
      </DataTable.Row>
    </DataTable.Header>
    <DataTable.Body>
      {#each types as entry (entry.type)}
        {@const revealed = stateOf(entry.type)}
        <DataTable.Row>
          <DataTable.Cell>{entry.label}</DataTable.Cell>
          <DataTable.Cell>
            {#if revealed.phase === "shown"}
              <span class="tabular-nums">{revealed.value}</span>
            {:else if revealed.phase === "reading"}
              <span class="text-text-muted">Reading</span>
            {:else if revealed.phase === "none"}
              <span class="text-text-muted">None held</span>
            {:else if revealed.phase === "refused"}
              <span class="text-text-muted">{revealed.message}</span>
            {:else}
              <span class="text-text-muted">Sealed</span>
            {/if}
          </DataTable.Cell>
          <DataTable.Cell data-align="end">
            <Button
              variant="ghost"
              size="icon"
              disabled={!mayReveal}
              title={revealDisabledReason}
              aria-label={revealed.phase === "shown"
                ? `Hide the ${entry.label.toLowerCase()}`
                : `Reveal the ${entry.label.toLowerCase()}`}
              onclick={() => void reveal(entry.type)}
            >
              {#if revealed.phase === "shown"}
                <EyeOff class="size-16" aria-hidden="true" />
              {:else}
                <Eye class="size-16" aria-hidden="true" />
              {/if}
            </Button>
          </DataTable.Cell>
        </DataTable.Row>
      {/each}
    </DataTable.Body>
  </DataTable.Root>
</section>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-xl">
    <div class="flex flex-col gap-16">
      <div class="flex flex-col gap-8">
        <Dialog.Title>Record An Identifier</Dialog.Title>
        <Dialog.Description>
          The value is sealed under the firm's key as it arrives. Nothing stores it in the clear, and
          reading it back later is recorded.
        </Dialog.Description>
      </div>

      <div class="flex flex-col gap-8">
        <Label id="new-identifier-type-label">Type</Label>
        <Select.Root
          type="single"
          items={typeItems}
          bind:value={
            () => newType, (chosen) => (newType = chosen as DirectoryIdentifierType)
          }
          allowDeselect={false}
        >
          <Select.Trigger class="min-w-64" aria-labelledby="new-identifier-type-label">
            <Select.Value />
          </Select.Trigger>
          <Select.Content>
            {#each typeItems as item (item.value)}
              <Select.Item value={item.value} label={item.label} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>

      <div class="flex flex-col gap-8">
        <Label for="new-identifier-value">Value</Label>
        <Input
          id="new-identifier-value"
          bind:value={newValue}
          autocomplete="off"
          placeholder={placeholderOf("Value")}
        />
      </div>

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
        <Button
          variant="primary"
          disabled={newValue.trim() === "" || submitting}
          onclick={submit}
        >
          {submitting ? "Sealing" : "Seal And Record"}
        </Button>
      </div>
    </div>
  </Dialog.Content>
</Dialog.Root>
