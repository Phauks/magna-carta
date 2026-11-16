<script lang="ts">
  /*
   * Naming a folder: a new one, or one the member already has.
   *
   * A folder is the member's own and arranges only their list, so the dialog asks for a name and
   * nothing else. It says nothing about who can read the conversations put in it, because a folder
   * decides nothing about that; the matter a conversation is kept on does.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import Input from "@magna-carta/design-system/input";
  import LabelledField from "@magna-carta/design-system/labelled-field";
  import { placeholderOf } from "@magna-carta/design-system/formatters";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import type { ConversationShelf } from "./conversation-shelf.svelte.ts";
  import type { MagnusFolder } from "./magnus-api.ts";

  /** The longest name the server keeps; a folder's name is a label in a narrow rail. */
  const FOLDER_NAME_MAX_LENGTH = 80;

  let {
    open = $bindable(false),
    shelf,
    folder = null,
  }: {
    open?: boolean;
    shelf: ConversationShelf;
    /** The folder being renamed, or null to make a new one. */
    folder?: MagnusFolder | null;
  } = $props();

  let name = $state("");
  let failure = $state<StatedFailure | null>(null);

  const trimmed = $derived(name.trim());
  const refusal = $derived.by((): string | undefined => {
    if (trimmed === "") return "Give the folder a name.";
    if (trimmed.length > FOLDER_NAME_MAX_LENGTH) {
      return `A folder name can be at most ${FOLDER_NAME_MAX_LENGTH} characters.`;
    }
    if (folder !== null && trimmed === folder.name) return "The name is unchanged.";
    return undefined;
  });

  function reset(): void {
    name = folder?.name ?? "";
    failure = null;
  }

  async function commit(): Promise<ActionOutcome> {
    failure = null;
    const outcome =
      folder === null ? await shelf.create(trimmed) : await shelf.rename(folder.id, trimmed);
    if (outcome.kind === "ok") return "committed";
    failure = stated(
      outcome.failure,
      folder === null ? "The folder wasn't added." : "The folder wasn't renamed.",
      folder === null
        ? "Couldn't connect. The folder wasn't added. Try again."
        : "Couldn't connect. The folder wasn't renamed. Try again.",
    );
    return "refused";
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading={folder === null ? "Add Folder" : "Rename Folder"}
  commitLabel={folder === null ? "Add Folder" : "Rename Folder"}
  commitBusyLabel={folder === null ? "Adding" : "Renaming"}
  commitRefusal={refusal}
  width="narrow"
  unsavedChanges={trimmed !== (folder?.name ?? "")}
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
    <LabelledField label="Name">
      {#snippet children({ props })}
        <Input {...props} disabled={busy} bind:value={name} placeholder={placeholderOf("Name")} />
      {/snippet}
    </LabelledField>
  {/snippet}
</ActionDialog>
