<script lang="ts">
  /*
   * The Upload dialog. The real file picker still comes FIRST — that ruling stands — and this
   * shows the batch landing while asking the one question the picker cannot: which folder.
   *
   * THE BYTES DO NOT WAIT ON THE ANSWER. Each file starts uploading the moment the dialog opens,
   * into the folder the reader is standing in, and every file shows its own progress line. Picking
   * a different destination while they run re-files them there as each one lands — so a slow
   * upload and a careful destination choice happen at the same time instead of in sequence.
   *
   * Closing the dialog abandons nothing: whatever has landed stays where it landed, and the
   * dialog says so rather than implying a cancel un-uploads bytes that are already committed.
   *
   * TWO SIDES, TWO JOBS. The left is the DECISION — where this batch goes — and the right is the
   * REPORT — what each file is doing about it. They belong apart because they move at different
   * speeds: the reader makes one choice once, while the list underneath it changes every second,
   * and stacking them meant the choice jumped down the dialog as lines arrived. They are the
   * shell's two panes: the decision is the fields, the report is the context beside them.
   *
   * Saving the destination is an act that does not end the panel: the commit reports `done`, the
   * bar ends at Close, and the report goes on running until the host closes the panel itself once
   * the last file has landed.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Alert from "@magna-carta/design-system/alert";
  import Label from "@magna-carta/design-system/label";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import LoaderCircle from "@lucide/svelte/icons/loader-circle";
  import type { MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";
  import { UPLOAD_STAGE_NARRATION, type UploadProgressItem } from "./file-upload.ts";
  import { countPhrase } from "./file-manager-vocabulary.ts";

  let {
    open = $bindable(false),
    index,
    /** The folder the reader was standing in when the batch was picked — where the bytes land first. */
    baseFolderId,
    matterTitle,
    items,
    /** Whether a destination has been confirmed already (the choice is then locked in). */
    confirmed,
    onConfirm,
    onDismiss,
  }: {
    open?: boolean;
    index: MatterFileIndex;
    baseFolderId: string | null;
    matterTitle: string;
    items: readonly UploadProgressItem[];
    confirmed: boolean;
    onConfirm: (destinationFolderId: string | null) => Promise<void>;
    onDismiss: () => void;
  } = $props();

  type Destination = "here" | "root" | "other";
  let choice = $state<Destination>("here");
  let pickedFolderId = $state<string | null>(null);

  function reset(): void {
    choice = "here";
    pickedFolderId = null;
  }

  const hereName = $derived(baseFolderId === null ? null : index.pathText(baseFolderId));
  const destinationFolderId = $derived(
    choice === "here" ? baseFolderId : choice === "root" ? null : pickedFolderId,
  );

  const failures = $derived(items.filter((item) => item.stage === "failed"));
  const settledCount = $derived(
    items.filter((item) => item.stage === "settled" || item.stage === "failed").length,
  );

  async function save(): Promise<ActionOutcome> {
    await onConfirm(destinationFolderId);
    return "done";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Upload"
  subtitle={`${countPhrase(items.length, "file")} — each is uploading now, and lands in the folder chosen below.`}
  commitLabel="Save"
  commitBusyLabel="Saving"
  commitRefusal={items.length === 0 ? "Nothing is uploading." : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={save}
  {onDismiss}
>
  <!-- LEFT: the one decision this dialog exists to ask. -->
  {#snippet fields({ busy })}
    <p class="text-xs font-semibold text-text-muted">Where these go</p>
    <RadioGroup.Root
      bind:value={() => choice, (next) => (choice = next as Destination)}
      disabled={confirmed || busy}
    >
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="here" id="upload-destination-here" />
        <Label for="upload-destination-here">
          {hereName === null ? `Home: ${matterTitle}` : `Current Folder: ${hereName}`}
        </Label>
      </div>
      {#if hereName !== null}
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="root" id="upload-destination-root" />
          <Label for="upload-destination-root">Home: {matterTitle}</Label>
        </div>
      {/if}
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="other" id="upload-destination-other" />
        <Label for="upload-destination-other">Select Folder</Label>
      </div>
    </RadioGroup.Root>

    {#if choice === "other"}
      <FolderPicker {index} bind:chosenFolderId={pickedFolderId} label="Upload destination" />
    {/if}

    {#if !confirmed}
      <p class="text-xs text-text-subtle">
        Closing keeps what has already landed in {hereName === null ? "Home" : hereName}.
      </p>
    {/if}
  {/snippet}

  <!-- RIGHT: what the batch is doing, file by file, while that choice is made. -->
  {#snippet context()}
    <p class="flex items-baseline gap-8 text-xs font-semibold text-text-muted">
      Progress
      <span class="font-regular text-text-subtle">
        {settledCount} of {items.length} finished
      </span>
    </p>
    <ul class="mt-8 flex flex-col gap-4" aria-label="Upload progress">
      {#each items as item (item.name)}
        <li class="flex items-center gap-8 text-sm">
          {#if item.stage === "settled"}
            <CircleCheck
              class="size-16 shrink-0 text-status-success-subtle-foreground"
              aria-hidden="true"
            />
          {:else if item.stage === "failed"}
            <CircleAlert
              class="size-16 shrink-0 text-status-danger-subtle-foreground"
              aria-hidden="true"
            />
          {:else}
            <LoaderCircle class="size-16 shrink-0 text-text-subtle" aria-hidden="true" />
          {/if}
          <span class="min-w-0 truncate" title={item.name}>{item.name}</span>
          <span class="ms-auto text-xs whitespace-nowrap text-text-subtle">
            {item.stage === "failed"
              ? "Did not land"
              : item.stage === "settled"
                ? "Saved"
                : UPLOAD_STAGE_NARRATION[item.stage]}
          </span>
        </li>
      {/each}
    </ul>

    {#if failures.length > 0}
      <div class="mt-12">
        <Alert.Root variant="warning">
          <Alert.Title>Some of These Did Not Land</Alert.Title>
          <Alert.Description>
            {#each failures as failure (failure.name)}
              <span class="block">{failure.name}: {failure.reason}</span>
            {/each}
          </Alert.Description>
        </Alert.Root>
      </div>
    {/if}
  {/snippet}
</ActionDialog>
