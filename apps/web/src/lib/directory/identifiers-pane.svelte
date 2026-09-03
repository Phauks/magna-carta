<script lang="ts">
  /*
   * The sealed identifiers the firm holds for an entity.
   *
   * These are the values a directory is trusted with and a firm is sued over: a social security
   * number, a tax number, a licence, an account. None of them is stored in the clear. What the firm
   * keeps is the sealed value and, for the types whose entropy allows it, an exact-match index that
   * lets a conflicts check say "these are the same person" without ever decrypting anything.
   *
   * WHAT IS HELD AND WHAT IT IS ARE TWO DIFFERENT QUESTIONS, and this pane asks only the first one
   * to draw itself. The enumeration says which types the record carries, when each was recorded and
   * how long it is valid for, and it decrypts nothing — no permission, no audit row, because it
   * reveals nothing a member with the record open did not already have. Reading a VALUE is the
   * separate act: refused without the permission, and written to the firm's audit log before any
   * plaintext exists. A record that had to decrypt merely to draw its list of headings would put a
   * plaintext social security number into that log every time somebody opened a page.
   *
   * A type the record does not carry is simply not a row. The pane never lists the seven types a
   * record COULD hold as though each were an absence waiting to be filled — an empty record says so
   * once.
   *
   * WHERE A TYPE IS HELD MORE THAN ONCE, the count says so and the reveal shows the most recently
   * recorded one. Silently showing one of two account numbers as though it were the only one is the
   * failure this count exists to prevent.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import { guidanceFor } from "$lib/diagnostics/guidance.ts";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import * as DataTable from "@magna-carta/design-system/data-table";
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as Select from "@magna-carta/design-system/select";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Plus from "@lucide/svelte/icons/plus";
  import ShieldCheck from "@lucide/svelte/icons/shield-check";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import {
    addDirectoryIdentifier,
    readDirectoryIdentifier,
    readDirectoryIdentifierRecords,
    type DirectoryEntityKind,
    type DirectoryIdentifierRecord,
    type DirectoryIdentifierType,
  } from "./directory-api.ts";
  import { identifierTypeLabel, identifierTypesFor } from "./directory-vocabulary.ts";

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

  // ---- what is held ---------------------------------------------------------------------------

  let held = $state<readonly DirectoryIdentifierRecord[] | null>(null);
  let readFailure = $state<StatedFailure | null>(null);
  let reloadToken = $state(0);

  $effect(() => {
    const id = entityId;
    void reloadToken;
    let cancelled = false;
    held = null;
    readFailure = null;
    void (async () => {
      const outcome = await readDirectoryIdentifierRecords(fetch, id);
      if (cancelled) return;
      if (outcome.kind === "ok") {
        held = outcome.value.data;
        return;
      }
      held = [];
      readFailure = stated(outcome.failure, "What this record holds could not be read.");
    })();
    return () => {
      cancelled = true;
    };
  });

  /** One row per TYPE held, carrying how many of that type the record holds and the newest instant. */
  interface HeldType {
    type: DirectoryIdentifierType;
    label: string;
    count: number;
    recordedAt: string;
    validTo: string | null;
  }

  const heldTypes = $derived.by((): readonly HeldType[] => {
    const grouped = new Map<DirectoryIdentifierType, HeldType>();
    for (const record of held ?? []) {
      const existing = grouped.get(record.type);
      if (existing === undefined) {
        grouped.set(record.type, {
          type: record.type,
          label: identifierTypeLabel(record.type),
          count: 1,
          recordedAt: record.recordedAt,
          validTo: record.validTo,
        });
        continue;
      }
      // The enumeration is ordered newest-first within a type, so the first one seen is the one a
      // reveal would return — the rest only raise the count.
      grouped.set(record.type, { ...existing, count: existing.count + 1 });
    }
    return [...grouped.values()];
  });

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
        // One row's reveal, refused. It renders as a line in the cell rather than as a failure
        // surface, so it takes the presenter's sentence and not the whole record: there is nowhere
        // in a table cell to put a handle and a remedy, and a band per row would bury the table.
        message: guidanceFor(outcome.failure, "The value").message,
      },
    };
  }

  // ---- recording a value --------------------------------------------------------------------

  let open = $state(false);
  // Defaulted to a type BOTH kinds can hold, so the initial value never references the
  // kind-filtered list and never has to be corrected after the fact.
  let newType = $state<DirectoryIdentifierType>("account");
  let newValue = $state("");
  let failure = $state<StatedFailure | null>(null);

  function resetDraft(): void {
    newValue = "";
    failure = null;
  }

  const typeItems = $derived(
    types.map((entry) => ({ value: entry.type, label: entry.label })),
  );

  async function submit(): Promise<ActionOutcome> {
    if (newValue.trim() === "") return "refused";
    failure = null;
    const outcome = await addDirectoryIdentifier(
      fetch,
      entityId,
      { type: newType, value: newValue.trim() },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      // The stored value is sealed on arrival, so what was typed is discarded here too: the pane
      // never keeps a plaintext copy of something it just sealed.
      newValue = "";
      reveals = { ...reveals, [newType]: { phase: "sealed" } };
      reloadToken += 1;
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The identifier could not be recorded.",
      "Nothing was sealed.",
    );
    return "refused";
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

  {#if readFailure !== null}
    <FailureNotice
      failure={readFailure.failure}
      title="What This Record Holds Could Not Be Read"
      fallback={readFailure.fallback}
      whenSilent={readFailure.whenSilent}
    />
  {:else if held === null}
    <div class="flex flex-col gap-8" aria-busy="true" aria-label="Reading what this record holds">
      <Skeleton class="h-32 w-full" />
      <Skeleton class="h-32 w-full" />
    </div>
  {:else if heldTypes.length === 0}
    <EmptyState title="Nothing Sealed Against This Record">
      The firm holds no sealed identifier for this record. Recording one seals it under the firm's
      key as it arrives; nothing here is ever stored in the clear.
    </EmptyState>
  {:else}
    <DataTable.Root>
      <DataTable.Caption class="sr-only">The sealed identifiers this record holds</DataTable.Caption>
      <DataTable.Header>
        <DataTable.Row>
          <DataTable.Head>Type</DataTable.Head>
          <DataTable.Head>Value</DataTable.Head>
          <DataTable.Head>Recorded</DataTable.Head>
          <DataTable.Head data-align="end">Reveal</DataTable.Head>
        </DataTable.Row>
      </DataTable.Header>
      <DataTable.Body>
        {#each heldTypes as entry (entry.type)}
          {@const revealed = stateOf(entry.type)}
          <DataTable.Row>
            <DataTable.Cell>
              <span class="flex flex-wrap items-center gap-8">
                {entry.label}
                {#if entry.count > 1}
                  <span class="text-xs text-text-muted">
                    {entry.count} held — the most recent is revealed
                  </span>
                {/if}
              </span>
            </DataTable.Cell>
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
            <DataTable.Cell>
              <span class="text-text-muted tabular-nums">{entry.recordedAt.slice(0, 10)}</span>
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
  {/if}
</section>

<ActionDialog
  bind:open
  kind="form"
  heading="Record An Identifier"
  subtitle="The value is sealed under the firm's key as it arrives. Nothing stores it in the clear, and reading it back later is recorded."
  commitLabel="Seal And Record"
  commitBusyLabel="Sealing"
  commitRefusal={newValue.trim() === "" ? "A value is required." : undefined}
  unsavedChanges={newValue.trim() !== ""}
  onOpen={resetDraft}
  onCommit={submit}
>
  {#snippet fields({ busy })}
    <div class="flex flex-col gap-8">
      <Label id="new-identifier-type-label">Type</Label>
      <Select.Root
        type="single"
        items={typeItems}
        bind:value={() => newType, (chosen) => (newType = chosen as DirectoryIdentifierType)}
        allowDeselect={false}
        disabled={busy}
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

    <LabelledField label="Value">
      {#snippet children({ props })}
        <Input
          {...props}
          disabled={busy}
          bind:value={newValue}
          autocomplete="off"
          placeholder={placeholderOf("Value")}
        />
      {/snippet}
    </LabelledField>
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="The Identifier Was Not Recorded"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}
</ActionDialog>
