<script lang="ts">
  /*
   * Restoring a deleted file ASKS — in what manner, not whether it is safe: nothing is
   * overwritten, the file returns with every version and its whole history intact. The default is
   * back where it was; when the folder went with the file, the host lands it at the matter root
   * and the option says so. Any other folder is one pick away through the shared picker.
   *
   * The host does the restoring and reports how it went; this panel owns only the question. Its
   * failure arrives as a sentence the host already worded, and is shown where the shell puts a
   * failure: beneath the fields, above the bar, outside the scroll.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Alert from "@magna-carta/design-system/alert";
  import Label from "@magna-carta/design-system/label";
  import type { DeletedFileSummary } from "./matter-file-api.ts";
  import type { MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";

  let {
    open = $bindable(false),
    index,
    file,
    failure,
    onConfirm,
    onDismiss,
  }: {
    open?: boolean;
    index: MatterFileIndex;
    file: DeletedFileSummary | null;
    failure: string | null;
    /** No folderId = back where it was (the host falls back to the root when the folder is gone). */
    onConfirm: (destination: { folderId?: string | null }) => Promise<ActionOutcome>;
    onDismiss: () => void;
  } = $props();

  type Manner = "back" | "other";
  let manner = $state<Manner>("back");
  let pickedFolderId = $state<string | null>(null);

  function reset(): void {
    manner = "back";
    pickedFolderId = null;
  }

  const folderSurvives = $derived(
    file !== null && (file.folderId === null || index.folderById(file.folderId) !== undefined),
  );
  const backLabel = $derived(
    file === null
      ? ""
      : folderSurvives
        ? `The original location: ${file.folderId === null ? "Home" : index.pathText(file.folderId)}`
        : "Home (its folder was deleted too)",
  );
</script>

<ActionDialog
  bind:open
  kind="confirm"
  heading={`Restore ${file?.name ?? "this file"}`}
  subtitle={{ facts: ["returns with every version and its whole history intact"] }}
  commitLabel="Restore"
  commitBusyLabel="Restoring"
  commitRefusal={file === null ? "No file is chosen." : undefined}
  unsavedChanges={false}
  onOpen={reset}
  onCommit={() => onConfirm(manner === "back" ? {} : { folderId: pickedFolderId })}
  {onDismiss}
>
  {#snippet fields({ busy })}
    <RadioGroup.Root
      bind:value={() => manner, (next) => (manner = next as Manner)}
      disabled={busy}
    >
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="back" id="restore-manner-back" />
        <Label for="restore-manner-back">{backLabel}</Label>
      </div>
      <div class="flex items-center gap-8">
        <RadioGroup.Item value="other" id="restore-manner-other" />
        <Label for="restore-manner-other">Select Folder</Label>
      </div>
    </RadioGroup.Root>

    {#if manner === "other"}
      <FolderPicker {index} bind:chosenFolderId={pickedFolderId} label="Restore destination" />
    {/if}
  {/snippet}

  {#snippet notice()}
    {#if failure !== null}
      <Alert.Root variant="warning">
        <Alert.Title>The Restore Did Not Go Through</Alert.Title>
        <Alert.Description>{failure}</Alert.Description>
      </Alert.Root>
    {/if}
  {/snippet}
</ActionDialog>
