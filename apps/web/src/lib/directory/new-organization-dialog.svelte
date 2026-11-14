<script lang="ts">
  /*
   * Adding an organization to the firm's directory.
   *
   * The same shape the New Person screen has — the entry on the left, the duplicate gate on the
   * right, permanently in view — with the one section an organization is created from: its legal
   * name, and the name it is called by when that differs. Everything else an organization holds
   * (how to reach it, its people, its identifiers) is recorded on the record afterwards; when its
   * record grows the person's sections this dialog grows the same rail.
   *
   * THE PANEL IS THE ACTION DIALOG SHELL, so this file holds the fields and the commit, and nothing
   * about the panel itself. The commit is refused, with the reason beside it, until the name is
   * enough to record; the refusal is the same sentence the duplicate check waits for.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { createDirectoryOrganization } from "./directory-api.ts";
  import DuplicateGate from "./duplicate-gate.svelte";

  let {
    open = $bindable(false),
    prefill = null,
    onCreated,
  }: {
    open?: boolean;
    /** A legal name already typed into a picker that could not find it, so it is not typed twice. */
    prefill?: { legalName: string } | null;
    /** The record's handle, and the name as this window recorded it (for a field that must show one). */
    onCreated: (entityId: string, recordedName: string) => void;
  } = $props();

  let legalName = $state("");
  let displayName = $state("");
  let failure = $state<StatedFailure | null>(null);

  const ready = $derived(legalName.trim() !== "");
  const refusal = $derived(ready ? undefined : "Give the organization's legal name.");
  const started = $derived(legalName.trim() !== "" || displayName.trim() !== "");

  function reset(): void {
    legalName = prefill?.legalName ?? "";
    displayName = "";
    failure = null;
  }

  async function submit(): Promise<ActionOutcome> {
    failure = null;
    // A retried submit must not make a second record, so every attempt carries its own key and the
    // server answers the repeat with the first result.
    const outcome = await createDirectoryOrganization(
      fetch,
      {
        legalName: legalName.trim(),
        displayName: displayName.trim() === "" ? null : displayName.trim(),
      },
      crypto.randomUUID(),
    );
    if (outcome.kind === "ok") {
      onCreated(
        outcome.value.id,
        displayName.trim() === "" ? legalName.trim() : displayName.trim(),
      );
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "Couldn't create the record.",
      "Nothing was recorded, so nothing was half-created.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Organization"
  commitLabel="Record Organization"
  commitBusyLabel="Recording"
  commitRefusal={refusal}
  width="record"
  unsavedChanges={started}
  onOpen={reset}
  onCommit={submit}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Couldn't Create the Record"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField label="Legal name">
        {#snippet children({ props })}
          <Input
            {...props}
            disabled={busy}
            bind:value={legalName}
            placeholder={placeholderOf("Legal name")}
          />
        {/snippet}
      </LabelledField>
      <LabelledField label="Display name">
        {#snippet children({ props })}
          <Input
            {...props}
            disabled={busy}
            bind:value={displayName}
            placeholder={placeholderOf("Display name")}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}

  {#snippet context()}
    <DuplicateGate kind="organization" {legalName} />
  {/snippet}
</ActionDialog>
