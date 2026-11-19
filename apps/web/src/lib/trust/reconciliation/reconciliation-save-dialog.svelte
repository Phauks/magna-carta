<script lang="ts">
  /*
   * SAVE: a named point to come back to. Restoring it later puts the ticks, the end date and the
   * end balance back as they were here; notes and files are kept either way.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { Failure } from "$lib/api/problem.ts";

  let {
    open = $bindable(false),
    suggestedName,
    onSave,
  }: {
    open?: boolean;
    suggestedName: string;
    onSave: (name: string, idempotencyKey: string) => Promise<Failure | null>;
  } = $props();

  let name = $state("");
  let failure = $state<Failure | null>(null);
  let key = "";

  function reset(): void {
    name = suggestedName;
    failure = null;
    key = crypto.randomUUID();
  }

  async function save(): Promise<ActionOutcome> {
    failure = await onSave(name.trim(), key);
    return failure === null ? "committed" : "refused";
  }
</script>

<ActionDialog
  bind:open
  heading="Save"
  width="narrow"
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={name.trim() === "" ? "Enter a name." : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={save}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice {failure} title="Nothing Was Saved" fallback="The reconciliation is unchanged." />
    {/if}
  {/snippet}
  {#snippet fields({ busy })}
    <LabelledField label="Name" hint="Shown in Restore Points.">
      {#snippet children({ props })}
        <Input {...props} disabled={busy} bind:value={name} />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
