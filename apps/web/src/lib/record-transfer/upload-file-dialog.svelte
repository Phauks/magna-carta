<script lang="ts">
  /*
   * Upload a File: choose the file and say what it holds.
   *
   * What the file holds decides what its rows become and which fields the Columns tab offers. The
   * answer is sent as the file's own slug, and handed back to the page with the file so the page
   * knows it before any pass exists.
   *
   * Nothing is sent until Upload is pressed. A file the run already has is refused by its
   * checksum, and a file over the size limit is refused before it is sent.
   */
  import ActionDialog, { type ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import FileInput from "@magna-carta/design-system/file-input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import ChoicePicker from "$lib/components/choice-picker.svelte";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { RecordTransferSourceFile } from "@magna-carta/api-client";
  import {
    FILE_KIND_CHOICES,
    fileKindChoiceFor,
    type TransferRecordKind,
  } from "./column-mapping.ts";
  import { SOURCE_FILE_BYTE_CAP, uploadSourceFile } from "./record-transfer-api.ts";

  let {
    open = $bindable(false),
    runId,
    runLabel,
    onUploaded,
  }: {
    open?: boolean;
    runId: string;
    runLabel: string;
    onUploaded: (file: RecordTransferSourceFile, recordKind: TransferRecordKind) => void;
  } = $props();

  const KIND_OPTIONS = FILE_KIND_CHOICES.map((choice) => ({
    value: choice.recordKind,
    label: choice.label,
  }));

  let chosen = $state<File | null>(null);
  let recordKind = $state("");
  let attempted = $state(false);
  let failure = $state<StatedFailure | null>(null);

  const fileMissing = $derived(chosen === null);
  const fileTooLarge = $derived(chosen !== null && chosen.size > SOURCE_FILE_BYTE_CAP);
  const kindMissing = $derived(recordKind === "");

  function reset(): void {
    chosen = null;
    recordKind = "";
    attempted = false;
    failure = null;
  }

  async function upload(): Promise<ActionOutcome> {
    attempted = true;
    failure = null;
    if (chosen === null || fileTooLarge || kindMissing) return "refused";
    const kind = recordKind as TransferRecordKind;
    const outcome = await uploadSourceFile(runId, chosen, fileKindChoiceFor(kind).fileKind);
    if (outcome.kind !== "ok") {
      failure = stated(outcome.failure, "Upload failed.");
      return "refused";
    }
    onUploaded(outcome.value.file, kind);
    return "committed";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  width="narrow"
  heading="Upload a File"
  subtitle={{ facts: [runLabel] }}
  commitLabel="Upload"
  commitBusyLabel="Uploading"
  unsavedChanges={chosen !== null}
  onOpen={reset}
  onCommit={upload}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        failure={failure.failure}
        title="Upload Failed"
        fallback={failure.fallback}
        whenSilent={failure.whenSilent}
      />
    {/if}
  {/snippet}

  {#snippet fields({ busy })}
    <div class="flex flex-col gap-16">
      <LabelledField
        label="File"
        error={attempted && fileMissing
          ? "Choose a file."
          : fileTooLarge
            ? `This file is over the ${String(SOURCE_FILE_BYTE_CAP / (1024 * 1024))} MB limit.`
            : undefined}
      >
        {#snippet children({ props })}
          <FileInput
            {...props}
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            disabled={busy}
            onchange={(event) => {
              chosen = event.currentTarget.files?.[0] ?? null;
            }}
          />
        {/snippet}
      </LabelledField>
      <LabelledField
        label="Contents"
        error={attempted && kindMissing ? "Choose the contents of this file." : undefined}
      >
        {#snippet children({ props })}
          <ChoicePicker
            inputId={props.id}
            label="Contents"
            options={KIND_OPTIONS}
            bind:value={recordKind}
            invalid={props["aria-invalid"] === true}
            disabled={busy}
          />
        {/snippet}
      </LabelledField>
    </div>
  {/snippet}
</ActionDialog>
