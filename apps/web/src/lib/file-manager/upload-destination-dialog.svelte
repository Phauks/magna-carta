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
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
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
    onClose,
  }: {
    open?: boolean;
    index: MatterFileIndex;
    baseFolderId: string | null;
    matterTitle: string;
    items: readonly UploadProgressItem[];
    confirmed: boolean;
    onConfirm: (destinationFolderId: string | null) => void;
    onClose: () => void;
  } = $props();

  type Destination = "here" | "root" | "other";
  let choice = $state<Destination>("here");
  let pickedFolderId = $state<string | null>(null);

  const hereName = $derived(baseFolderId === null ? null : index.pathText(baseFolderId));
  const destinationFolderId = $derived(
    choice === "here" ? baseFolderId : choice === "root" ? null : pickedFolderId,
  );

  const failures = $derived(items.filter((item) => item.stage === "failed"));
  const settledCount = $derived(
    items.filter((item) => item.stage === "settled" || item.stage === "failed").length,
  );
  const allSettled = $derived(items.length > 0 && settledCount === items.length);
</script>

<Dialog.Root
  bind:open={
    () => open,
    (next) => {
      open = next;
      if (!next) onClose();
    }
  }
>
  <Dialog.Content>
    <Dialog.Title>Upload</Dialog.Title>
    <Dialog.Description>
      {countPhrase(items.length, "file")} — each is uploading now, and lands in the folder chosen
      below.
    </Dialog.Description>

    <div class="flex flex-col gap-16">
      <ul class="flex max-h-96 flex-col gap-4 overflow-y-auto" aria-label="Upload progress">
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
            <span class="min-w-0 truncate">{item.name}</span>
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

      <RadioGroup.Root
        bind:value={() => choice, (next) => (choice = next as Destination)}
        disabled={confirmed}
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

      {#if failures.length > 0}
        <Alert.Root variant="warning">
          <Alert.Title>Some of These Did Not Land</Alert.Title>
          <Alert.Description>
            {#each failures as failure (failure.name)}
              <span class="block">{failure.name}: {failure.reason}</span>
            {/each}
          </Alert.Description>
        </Alert.Root>
      {/if}
    </div>

    <div class="flex items-center justify-end gap-8">
      {#if !confirmed}
        <span class="me-auto text-xs text-text-subtle">
          Closing keeps what has already landed in
          {hereName === null ? "Home" : hereName}.
        </span>
      {/if}
      <Button variant="secondary" onclick={onClose}>Close</Button>
      <Button
        disabled={confirmed || items.length === 0}
        onclick={() => onConfirm(destinationFolderId)}
      >
        {confirmed ? (allSettled ? "Saved" : "Saving") : "Save"}
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
