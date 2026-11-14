<script lang="ts">
  /*
   * New Run: a label, and the system the records come from.
   *
   * A run is what the files and passes of one attempt are recorded under ("Rehearsal 3", "Cutover").
   * The source system is a short fixed list, and LEAP is the first and the default.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { WriteIntent } from "$lib/api/write-intent.ts";
  import type { RecordTransferRun } from "@magna-carta/api-client";
  import { startTransferRun } from "./record-transfer-api.ts";
  import { sourceSystemLabel } from "./transfer-run-view.ts";

  let {
    open = $bindable(false),
    onStarted,
  }: {
    open?: boolean;
    onStarted: (run: RecordTransferRun) => void;
  } = $props();

  const SOURCE_SYSTEMS = [{ value: "leap", label: sourceSystemLabel("leap") }];

  let label = $state("");
  let sourceSystem = $state("leap");
  let attempted = $state(false);
  let failure = $state<StatedFailure | null>(null);
  const intent = new WriteIntent();

  const labelMissing = $derived(label.trim() === "");

  function reset(): void {
    label = "";
    sourceSystem = "leap";
    attempted = false;
    failure = null;
  }

  async function start(): Promise<ActionOutcome> {
    attempted = true;
    failure = null;
    if (labelMissing) return "refused";
    const { value: outcome } = await intent.submit((key) =>
      startTransferRun({ sourceSystem, label: label.trim() }, key),
    );
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "The run couldn't be started.");
      return "refused";
    }
    onStarted(outcome.value.run);
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  width="narrow"
  heading="New Run"
  commitLabel="Start Run"
  commitBusyLabel="Starting"
  unsavedChanges={!labelMissing}
  onOpen={reset}
  onCommit={start}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Nothing Changed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField label="Label" error={attempted && labelMissing ? "Enter a label." : undefined}>
        {#snippet children({ props })}
          <Input {...props} bind:value={label} maxlength={120} disabled={busy} autocomplete="off" />
        {/snippet}
      </LabelledField>
      <LabelledField label="Source System">
        {#snippet children({ props })}
          <ChoicePicker
            inputId={props.id}
            label="Source System"
            options={SOURCE_SYSTEMS}
            bind:value={sourceSystem}
            disabled={busy}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
