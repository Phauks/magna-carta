<script lang="ts">
  /*
   * What this person is called in the meeting, chosen by them.
   *
   * THE WAY BACK IS ONE PRESS. A chosen name is held for this meeting only, and the dialog always
   * offers the name they came in with as its own button, so going back never means remembering how
   * the account spells it. Everybody else sees that original beside a chosen name, which the dialog
   * says, because a name anybody can type is a name anybody could borrow.
   *
   * IT TAKES THE TWO NAMES AND A HANDLER, NOT THE CLIENT, like every other surface in this directory.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import { cleanDisplayName, MAX_MEETING_DISPLAY_NAME_LENGTH } from "../client/naming.ts";

  let {
    open = $bindable(false),
    currentName,
    originalName,
    guest = false,
    onRename,
  }: {
    open?: boolean;
    /** The name this person goes by in the meeting now. */
    currentName: string;
    /** The name they came in with: the account's, or for a guest the one typed at the door. */
    originalName: string;
    /** A guest has no account, so the way back is named for the name they joined with. */
    guest?: boolean;
    /** Go by this name, or by the original (`null`). */
    onRename: (name: string | null) => void;
  } = $props();

  let typed = $state("");

  // A fresh field each time the dialog opens, holding the name in use now.
  $effect(() => {
    if (open) typed = currentName;
  });

  const cleaned = $derived(cleanDisplayName(typed));
  const renamed = $derived(currentName !== originalName);
  const resetLabel = $derived(guest ? "Use the Name I Joined With" : "Use My Account Name");

  async function save(): Promise<ActionOutcome> {
    if (cleaned === null) return "refused";
    onRename(cleaned === originalName ? null : cleaned);
    return "committed";
  }

  function reset(): void {
    onRename(null);
    open = false;
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  heading="Change My Name"
  commitLabel="Save"
  commitRefusal={cleaned === null ? "Type a name first." : undefined}
  unsavedChanges={cleaned !== null && cleaned !== currentName}
  onCommit={save}
>
  {#snippet fields()}
    <div class="flex flex-col gap-8">
      <Label for="meeting-rename-name">Name in This Meeting</Label>
      <Input
        id="meeting-rename-name"
        bind:value={typed}
        maxlength={MAX_MEETING_DISPLAY_NAME_LENGTH}
        autocomplete="off"
      />
    </div>
    <p class="text-sm text-text-muted">
      This name is for this meeting only. Everybody in the room also sees the name you joined with,
      {originalName}, and the meeting's record keeps that name.
    </p>
    <div>
      <Button variant="secondary" size="sm" disabled={!renamed} onclick={reset}>
        {resetLabel}
      </Button>
    </div>
  {/snippet}
</ActionDialog>
