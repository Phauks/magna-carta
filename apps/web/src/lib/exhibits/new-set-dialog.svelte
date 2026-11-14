<script lang="ts">
  /*
   * Starting a set. A set is a name and, if the member wants it, a folder of this matter's files to
   * follow: the folder's files become the exhibits, in name order, and the set keeps up with the
   * folder until it is marked as filed. Following a folder is optional, so it starts as a button.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import * as Select from "@magna-carta/design-system/select";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import Plus from "@lucide/svelte/icons/plus";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import { listMatterFolders, type FolderSummary } from "$lib/file-manager/folder-api.ts";
  import { createExhibitSet, createExhibitSetFromFolder } from "./exhibits-api.ts";

  let {
    open = $bindable(false),
    matterId,
    onCreated,
  }: {
    open?: boolean;
    matterId: string;
    onCreated: (setId: string) => void;
  } = $props();

  let name = $state("");
  let following = $state(false);
  let folderId = $state("");
  let folders = $state<readonly FolderSummary[]>([]);
  let failure = $state<StatedFailure | null>(null);

  function reset(): void {
    name = "";
    following = false;
    folderId = "";
    failure = null;
    void listMatterFolders(fetch, matterId).then((outcome) => {
      folders = outcome.kind === "ok" ? outcome.value.data : [];
    });
  }

  const folderItems = $derived(
    [...folders]
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((folder) => ({ value: folder.id, label: folder.name })),
  );
  const chosenFolder = $derived(folders.find((folder) => folder.id === folderId) ?? null);

  const refusal = $derived.by((): string | undefined => {
    if (following && folderId === "") return "Choose the folder to follow.";
    if (!following && name.trim() === "") return "Name the set.";
    return undefined;
  });

  async function commit(): Promise<ActionOutcome> {
    failure = null;
    const trimmed = name.trim();
    const outcome =
      following && folderId !== ""
        ? await createExhibitSetFromFolder(
            fetch,
            matterId,
            folderId,
            trimmed === "" ? undefined : trimmed,
          )
        : await createExhibitSet(fetch, matterId, trimmed);
    if (outcome.kind === "ok") {
      onCreated(outcome.value.id);
      return "committed";
    }
    failure = stated(
      outcome.failure,
      "The set wasn't started.",
      "Couldn't connect, so no set was started.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="New Exhibit Set"
  commitLabel="Start Set"
  commitBusyLabel="Starting"
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={name.trim() !== "" || folderId !== ""}
  onOpen={reset}
  onCommit={commit}
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
      <LabelledField label="Name">
        {#snippet children({ props })}
          <Input
            {...props}
            disabled={busy}
            bind:value={name}
            placeholder={placeholderOf(chosenFolder?.name ?? "Plaintiff's Trial Exhibits")}
          />
        {/snippet}
      </LabelledField>

      {#if following}
        <div class="flex flex-col gap-8">
          <Label id="exhibit-folder-label">Folder to Follow</Label>
          <Select.Root
            type="single"
            items={folderItems}
            disabled={busy || folderItems.length === 0}
            bind:value={() => folderId, (picked) => (folderId = picked ?? "")}
          >
            <Select.Trigger aria-labelledby="exhibit-folder-label">
              <Select.Value
                placeholder={folderItems.length === 0
                  ? "This matter has no folders"
                  : placeholderOf("Folder")}
              />
            </Select.Trigger>
            <Select.Content>
              {#each folderItems as item (item.value)}
                <Select.Item value={item.value} label={item.label} />
              {/each}
            </Select.Content>
          </Select.Root>
          <p class="text-xs text-text-muted">
            The folder's files become the exhibits, in name order. Until the set is marked as filed, files added to or removed from the folder join or leave the set.
          </p>
        </div>
      {:else}
        <div>
          <Button variant="ghost" size="sm" disabled={busy} onclick={() => (following = true)}>
            <Plus class="size-16" aria-hidden="true" />Follow a Folder
          </Button>
        </div>
      {/if}
    </div>
  {/snippet}
</ActionDialog>
