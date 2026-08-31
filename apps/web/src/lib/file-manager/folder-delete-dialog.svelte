<script lang="ts">
  /*
   * Deleting a folder that still holds something.
   *
   * An EMPTY folder deletes with no dialog at all — there is no decision to make. A folder with
   * contents is the case that needs one, and KEEPING THE CONTENTS IS THE DEFAULT: cascade exists,
   * but it is never the accidental click. Deleting the contents sits last, after the two answers
   * that keep them.
   *
   * WHICH files are affected sits behind an honest count rather than filling the dialog: a reader
   * who wants the list opens it, and a reader who does not is not made to scroll past thirty names
   * to reach the buttons.
   *
   * The destination picker excludes the folder being deleted and everything beneath it, so the
   * contents cannot be asked to move into the thing they are being moved out of.
   */
  import * as Dialog from "@magna-carta/design-system/dialog";
  import * as RadioGroup from "@magna-carta/design-system/radio-group";
  import * as Alert from "@magna-carta/design-system/alert";
  import Button from "@magna-carta/design-system/button";
  import Label from "@magna-carta/design-system/label";
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { FolderSummary } from "./folder-api.ts";
  import type { MatterFile } from "./matter-file-api.ts";
  import type { MatterFileIndex } from "./file-rows.ts";
  import FolderPicker from "./folder-picker.svelte";
  import { countPhrase } from "./file-manager-vocabulary.ts";

  let {
    open = $bindable(false),
    index,
    folder,
    running,
    failure,
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    index: MatterFileIndex;
    folder: FolderSummary | null;
    running: boolean;
    failure: string | null;
    onConfirm: (choice: {
      keepContents: boolean;
      destinationFolderId: string | null;
    }) => void;
    onCancel: () => void;
  } = $props();

  type Keep = "up" | "root" | "other";
  let keepContents = $state(true);
  let where = $state<Keep>("up");
  let pickedFolderId = $state<string | null>(null);
  let showAffected = $state(false);

  const files = $derived<readonly MatterFile[]>(
    folder === null ? [] : index.subtreeFiles(folder.id),
  );
  const subfolderCount = $derived(folder === null ? 0 : index.descendantFolderIds(folder.id).length);
  const upName = $derived(
    folder === null || folder.parentFolderId === null
      ? "Home (the top level)"
      : index.pathText(folder.parentFolderId),
  );
  const destinationFolderId = $derived(
    where === "up" ? (folder?.parentFolderId ?? null) : where === "root" ? null : pickedFolderId,
  );
</script>

<Dialog.Root bind:open>
  <Dialog.Content>
    <Dialog.Title>Delete "{folder?.name ?? ""}"?</Dialog.Title>
    <Dialog.Description>
      This folder holds {countPhrase(files.length, "file")}{subfolderCount > 0
        ? ` in ${countPhrase(subfolderCount, "subfolder")}`
        : ""}. Deleting a file here is a soft delete: nothing is destroyed.
    </Dialog.Description>

    <div class="flex flex-col gap-16">
      {#if files.length > 0}
        <div class="flex flex-col gap-4">
          <Button
            variant="ghost"
            size="sm"
            class="justify-start"
            aria-expanded={showAffected}
            onclick={() => (showAffected = !showAffected)}
          >
            {#if showAffected}
              <ChevronDown class="size-16" aria-hidden="true" />
            {:else}
              <ChevronRight class="size-16" aria-hidden="true" />
            {/if}
            Show the {countPhrase(files.length, "file")} this affects
          </Button>
          {#if showAffected}
            <ul
              class="mc-scrollbar max-h-96 overflow-y-auto rounded-md bg-surface-sunken p-8 text-sm"
            >
              {#each files as file (file.id)}
                <li class="truncate">{index.pathText(file.folderId)} / {file.name}</li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <RadioGroup.Root
        bind:value={() => (keepContents ? "keep" : "cascade"), (next) => (keepContents = next === "keep")}
      >
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="keep" id="folder-delete-keep" />
          <Label for="folder-delete-keep">Keep the contents and move them somewhere else</Label>
        </div>
        <div class="flex items-center gap-8">
          <RadioGroup.Item value="cascade" id="folder-delete-cascade" />
          <Label for="folder-delete-cascade">
            Delete the contents too ({countPhrase(files.length, "file")}, recoverable)
          </Label>
        </div>
      </RadioGroup.Root>

      {#if keepContents}
        <div class="flex flex-col gap-8">
          <RadioGroup.Root bind:value={() => where, (next) => (where = next as Keep)}>
            <div class="flex items-center gap-8">
              <RadioGroup.Item value="up" id="folder-delete-up" />
              <Label for="folder-delete-up">Up one level, into {upName}</Label>
            </div>
            <div class="flex items-center gap-8">
              <RadioGroup.Item value="root" id="folder-delete-root" />
              <Label for="folder-delete-root">Home, the top level of this matter</Label>
            </div>
            <div class="flex items-center gap-8">
              <RadioGroup.Item value="other" id="folder-delete-other" />
              <Label for="folder-delete-other">Another folder</Label>
            </div>
          </RadioGroup.Root>
          {#if where === "other"}
            <FolderPicker
              {index}
              bind:chosenFolderId={pickedFolderId}
              excludeFolderId={folder?.id ?? null}
              label="Where the contents go"
            />
          {/if}
        </div>
      {/if}

      {#if failure !== null}
        <Alert.Root variant="danger">
          <Alert.Title>Nothing Was Deleted</Alert.Title>
          <Alert.Description>{failure}</Alert.Description>
        </Alert.Root>
      {/if}
    </div>

    <div class="flex justify-end gap-8">
      <Button variant="secondary" disabled={running} onclick={onCancel}>Cancel</Button>
      <Button
        variant="destructive"
        disabled={running}
        onclick={() => onConfirm({ keepContents, destinationFolderId })}
      >
        Delete Folder
      </Button>
    </div>
  </Dialog.Content>
</Dialog.Root>
