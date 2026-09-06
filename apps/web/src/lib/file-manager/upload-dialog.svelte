<script lang="ts">
  /*
   * The Upload dialog — where files are chosen, where they are told to go, and the one press that
   * sends them.
   *
   * NOTHING IS SENT UNTIL UPLOAD IS PRESSED. An earlier round opened the picker first and let the
   * bytes go the moment it closed, asking the destination afterwards; a reader who then closed the
   * dialog was told what had "already landed", and read that as something saved behind their back —
   * which it was. So the order is now the one a reader expects: choose (one file, several, or a
   * whole folder — dropped onto the surface or picked with a button), say where they go, press
   * Upload. Cancelling before that sends nothing, so there is nothing to un-save.
   *
   * ONCE PRESSED, THE PANEL STAYS UNTIL THE BATCH IS THROUGH. The commit holds the busy state for
   * the whole transfer and the shell refuses to close a busy panel, so a batch is never abandoned
   * half-sent with nobody watching. When every file lands the panel closes and the host shows the
   * folder they landed in; when any fails it stays to say which and why, and leaves through Close.
   *
   * TWO SIDES, TWO JOBS. The left is the DECISION — what goes, and where — and the right is the
   * REPORT: what was chosen, then what each file is doing about it. They belong apart because they
   * move at different speeds: the reader makes the choice once, while the list beside it changes
   * every second once the transfer runs.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Dropzone, {
    entriesFromFileList,
    type DroppedEntry,
  } from "@magna-carta/design-system/dropzone";
  import Label from "@magna-carta/design-system/label";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleAlert from "@lucide/svelte/icons/circle-alert";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import FolderUp from "@lucide/svelte/icons/folder-up";
  import X from "@lucide/svelte/icons/x";
  import { formatBytes, type MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";
  import { UPLOAD_STAGE_NARRATION, type UploadProgressItem } from "./file-upload.ts";
  import { countPhrase } from "./file-manager-vocabulary.ts";

  let {
    open = $bindable(false),
    index,
    /** The folder the reader is standing in — the default upload location. */
    baseFolderId,
    matterTitle,
    /** Files the dialog opens already holding — what was dropped onto the list. */
    preselected,
    /** Each file's live line once the transfer runs; empty before Upload is pressed. */
    items,
    onUpload,
    onDismiss,
  }: {
    open?: boolean;
    index: MatterFileIndex;
    baseFolderId: string | null;
    matterTitle: string;
    preselected: readonly DroppedEntry[];
    items: readonly UploadProgressItem[];
    /** Send the batch to the chosen folder. Resolves once every file has settled, one way or the other. */
    onUpload: (
      chosen: readonly DroppedEntry[],
      destinationFolderId: string | null,
    ) => Promise<{ failed: number }>;
    onDismiss: () => void;
  } = $props();

  type Destination = "here" | "root" | "other";
  let choice = $state<Destination>("here");
  let pickedFolderId = $state<string | null>(null);
  let chosen = $state<DroppedEntry[]>([]);
  /** Upload has been pressed: the choice is locked and the report shows the transfer. */
  let started = $state(false);
  let folderPicker = $state<HTMLInputElement | null>(null);

  function reset(): void {
    choice = "here";
    pickedFolderId = null;
    chosen = [...preselected];
    started = false;
  }

  /** One file offered twice is one file: a second drop of the same folder must not double it. */
  function keyOf(entry: DroppedEntry): string {
    return `${entry.relativePath} ${entry.file.name} ${String(entry.file.size)}`;
  }

  function add(entries: readonly DroppedEntry[]): void {
    const seen = new Set(chosen.map(keyOf));
    chosen = [...chosen, ...entries.filter((entry) => !seen.has(keyOf(entry)))];
  }

  function removeAt(at: number): void {
    chosen = chosen.filter((_, position) => position !== at);
  }

  /** What an entry is called in the list: its path when it came from a folder. */
  function itemName(entry: DroppedEntry): string {
    return entry.relativePath === "" ? entry.file.name : entry.relativePath;
  }

  const hereName = $derived(baseFolderId === null ? null : index.pathText(baseFolderId));
  const destinationFolderId = $derived(
    choice === "here" ? baseFolderId : choice === "root" ? null : pickedFolderId,
  );

  const folderCount = $derived(
    new Set(
      chosen
        .map((entry) => entry.relativePath.split("/")[0] ?? "")
        .filter((head) => head !== ""),
    ).size,
  );
  const chosenPhrase = $derived(
    folderCount === 0
      ? countPhrase(chosen.length, "file")
      : `${countPhrase(folderCount, "folder")}, ${countPhrase(chosen.length, "file")} inside`,
  );

  const failures = $derived(items.filter((item) => item.stage === "failed"));
  const settledCount = $derived(
    items.filter((item) => item.stage === "settled" || item.stage === "failed").length,
  );

  const refusal = $derived(
    !started && chosen.length === 0 ? "Choose a file or a folder first." : undefined,
  );

  async function upload(): Promise<ActionOutcome> {
    started = true;
    const result = await onUpload(chosen, destinationFolderId);
    return result.failed === 0 ? "committed" : "done";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Upload"
  commitLabel="Upload"
  commitBusyLabel="Uploading"
  commitRefusal={refusal}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={upload}
  {onDismiss}
>
  <!-- LEFT: what goes, and where. -->
  {#snippet fields({ busy })}
    {#if !started}
      <Dropzone
        multiple
        label="Choose files"
        prompt="Drag files or a folder here, or choose them"
        onEntries={add}
      />
      <div class="flex items-center gap-8">
        <Button variant="secondary" size="sm" onclick={() => folderPicker?.click()}>
          <FolderUp class="size-16" aria-hidden="true" />
          Choose a Folder
        </Button>
        <span class="text-xs text-text-subtle">
          A folder is recreated, with everything inside it, at the location below.
        </span>
      </div>
      <!-- The folder picker: a native input asking for a whole directory, opened by the button. -->
      <input
        bind:this={folderPicker}
        type="file"
        webkitdirectory
        multiple
        class="sr-only"
        aria-hidden="true"
        tabindex="-1"
        onchange={(event) => {
          const files = event.currentTarget.files;
          if (files !== null) add(entriesFromFileList(files));
          event.currentTarget.value = "";
        }}
      />
    {/if}

    <p class="text-xs font-semibold text-text-muted">Upload Location</p>
    <RadioGroup.Root
      bind:value={() => choice, (next) => (choice = next as Destination)}
      disabled={started || busy}
    >
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="here" id="upload-location-here" />
        <Label for="upload-location-here">
          {hereName === null ? `Home: ${matterTitle}` : `Current Folder: ${hereName}`}
        </Label>
      </div>
      {#if hereName !== null}
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="root" id="upload-location-root" />
          <Label for="upload-location-root">Home: {matterTitle}</Label>
        </div>
      {/if}
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="other" id="upload-location-other" />
        <Label for="upload-location-other">Select Folder</Label>
      </div>
    </RadioGroup.Root>

    {#if choice === "other"}
      <FolderPicker {index} bind:chosenFolderId={pickedFolderId} label="Upload location" />
    {/if}
  {/snippet}

  <!-- RIGHT: what was chosen, then what each file is doing about it. -->
  {#snippet context()}
    {#if !started}
      <p class="flex items-baseline gap-8 text-xs font-semibold text-text-muted">
        Chosen
        <span class="font-regular text-text-subtle">{chosenPhrase}</span>
      </p>
      {#if chosen.length === 0}
        <p class="mt-8 text-sm text-text-muted">
          Nothing chosen yet. Nothing is sent until Upload is pressed.
        </p>
      {:else}
        <ul class="mt-8 flex flex-col gap-4" aria-label="Files chosen">
          {#each chosen as entry, at (keyOf(entry))}
            <li class="flex items-center gap-8 text-sm">
              <span class="min-w-0 truncate" title={itemName(entry)}>{itemName(entry)}</span>
              <span class="ms-auto text-xs whitespace-nowrap text-text-subtle">
                {formatBytes(entry.file.size)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onclick={() => removeAt(at)}
                aria-label={`Remove ${entry.file.name}`}
              >
                <X class="size-16" aria-hidden="true" />
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      <p class="flex items-baseline gap-8 text-xs font-semibold text-text-muted">
        Progress
        <span class="font-regular text-text-subtle">
          {settledCount} of {items.length} finished
        </span>
      </p>
      <ul class="mt-8 flex flex-col gap-4" aria-label="Upload progress">
        {#each items as item, position (position)}
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
              <!-- Not yet landed. The stage beside the name says what the file is doing; the mark
                   only says it is not finished, the way an unwritten row reads on the time sheet. -->
              <CircleDashed class="size-16 shrink-0 text-text-subtle" aria-hidden="true" />
            {/if}
            <span class="min-w-0 truncate" title={item.name}>{item.name}</span>
            <span class="ms-auto text-xs whitespace-nowrap text-text-subtle">
              {item.stage === "failed"
                ? "Upload failed"
                : item.stage === "settled"
                  ? "Uploaded"
                  : UPLOAD_STAGE_NARRATION[item.stage]}
            </span>
          </li>
        {/each}
      </ul>

      {#if failures.length > 0}
        <div class="mt-12">
          <Alert.Root variant="warning">
            <Alert.Title>Upload Failed</Alert.Title>
            <Alert.Description>
              {#each failures as failure, position (position)}
                <span class="block">{failure.name}: {failure.reason}</span>
              {/each}
            </Alert.Description>
          </Alert.Root>
        </div>
      {/if}
    {/if}
  {/snippet}
</ActionDialog>
