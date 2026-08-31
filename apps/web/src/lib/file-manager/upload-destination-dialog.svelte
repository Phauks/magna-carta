<script lang="ts">
  /*
   * Where an upload lands. The real file picker still comes FIRST — that ruling stands — and this
   * asks the one question the picker cannot: which folder.
   *
   * Three answers, in the order a reader wants them: the folder they are looking at (the default,
   * because it is right nearly always), the matter root, or any other folder through the shared
   * picker. Saving a new version asks nothing at all: its destination is the file it was asked on.
   *
   * The names being uploaded are listed, because an upload of five files into the wrong folder is
   * five things to move back and the moment to notice is before it happens, not after.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import Progress from "@magna-carta/design-system/progress";
  import type { MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";
  import { UPLOAD_STAGE_NARRATION, type UploadStage } from "./file-upload.ts";
  import { countPhrase } from "./file-manager-vocabulary.ts";

  let {
    open = $bindable(false),
    index,
    /** The folder the reader is standing in, or null when the view has no current folder. */
    currentFolderId,
    files,
    running,
    stage,
    completed,
    failures,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    index: MatterFileIndex;
    currentFolderId: string | null;
    files: readonly File[];
    running: boolean;
    stage: UploadStage | null;
    /** How many of the batch have finished, for the progress the reader watches. */
    completed: number;
    /** What went wrong, per file, stated rather than swallowed. */
    failures: readonly { name: string; reason: string }[];
    onConfirm: (destinationFolderId: string | null) => void;
    onCancel: () => void;
  } = $props();

  type Destination = "here" | "root" | "other";
  let choice = $state<Destination>("here");
  let pickedFolderId = $state<string | null>(null);

  const hereName = $derived(
    currentFolderId === null ? "Home (the top level)" : index.pathText(currentFolderId),
  );
  const destinationFolderId = $derived(
    choice === "here" ? currentFolderId : choice === "root" ? null : pickedFolderId,
  );
  const percent = $derived(files.length === 0 ? 0 : Math.round((completed / files.length) * 100));
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Title>Where Should This Go?</Dialog.Title>
    <Dialog.Description>
      {countPhrase(files.length, "file")} ready to upload: {files.map((file) => file.name).join(", ")}
    </Dialog.Description>

    <div class="flex flex-col gap-16">
      <RadioGroup.Root bind:value={() => choice, (next) => (choice = next as Destination)}>
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="here" id="upload-destination-here" />
          <Label for="upload-destination-here">The folder you are looking at: {hereName}</Label>
        </div>
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="root" id="upload-destination-root" />
          <Label for="upload-destination-root">Home, the top level of this matter</Label>
        </div>
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="other" id="upload-destination-other" />
          <Label for="upload-destination-other">Another folder</Label>
        </div>
      </RadioGroup.Root>

      {#if choice === "other"}
        <FolderPicker {index} bind:chosenFolderId={pickedFolderId} label="Upload destination" />
      {/if}

      {#if running}
        <div class="flex flex-col gap-8">
          <Progress value={percent} aria-label="Upload progress" />
          <p class="text-sm text-text-muted" role="status" aria-live="polite">
            {stage === null ? "" : UPLOAD_STAGE_NARRATION[stage]}: {completed} of {files.length}
          </p>
        </div>
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

    <div class="flex justify-end gap-8">
      <Button variant="secondary" disabled={running} onclick={onCancel}>Cancel</Button>
      <Button disabled={running || files.length === 0} onclick={() => onConfirm(destinationFolderId)}>
        Upload
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
