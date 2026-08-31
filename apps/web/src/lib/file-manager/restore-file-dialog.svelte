<script lang="ts">
  /*
   * Restoring a deleted file ASKS — in what manner, not whether it is safe: nothing is
   * overwritten, the file returns with every version and its whole history intact. The default is
   * back where it was; when the folder went with the file, the host lands it at the matter root
   * and the option says so. Any other folder is one pick away through the shared picker.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import type { DeletedFileSummary } from "./matter-file-api.ts";
  import type { MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";

  let {
    open = $bindable(false),
    index,
    file,
    running,
    failure,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    index: MatterFileIndex;
    file: DeletedFileSummary | null;
    running: boolean;
    failure: string | null;
    /** No folderId = back where it was (the host falls back to the root when the folder is gone). */
    onConfirm: (destination: { folderId?: string | null }) => void;
    onCancel: () => void;
  } = $props();

  type Manner = "back" | "other";
  let manner = $state<Manner>("back");
  let pickedFolderId = $state<string | null>(null);

  const folderSurvives = $derived(
    file !== null && (file.folderId === null || index.folderById(file.folderId) !== undefined),
  );
  const backLabel = $derived(
    file === null
      ? ""
      : folderSurvives
        ? `The original location: ${file.folderId === null ? "Home" : index.pathText(file.folderId)}`
        : "Home — the folder it was in was deleted too",
  );
</script>

<Dialog.Root
  bind:open={
    () => open,
    (next) => {
      open = next;
      if (!next) onCancel();
    }
  }
>
  <Dialog.Content>
    <Dialog.Title>Restore {file?.name ?? "this file"}?</Dialog.Title>
    <Dialog.Description>
      Nothing is overwritten: the file returns with every version and its whole history intact.
    </Dialog.Description>

    <div class="flex flex-col gap-16">
      <RadioGroup.Root
        bind:value={() => manner, (next) => (manner = next as Manner)}
        disabled={running}
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

      {#if failure !== null}
        <Alert.Root variant="warning">
          <Alert.Title>The Restore Did Not Go Through</Alert.Title>
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}
    </div>

    <div class="flex justify-end gap-8">
      <Button variant="secondary" disabled={running} onclick={onCancel}>Cancel</Button>
      <Button
        disabled={running || file === null}
        onclick={() => onConfirm(manner === "back" ? {} : { folderId: pickedFolderId })}
      >
        Restore
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
