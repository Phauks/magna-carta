<script lang="ts">
  /*
   * A room's name: a member's own room, or one the firm shares.
   *
   * THE LINK FOLLOWS THE NAME. A room is addressed by what it is called (/room/red-room), so the
   * dialog says that the old link stops working, which is the owner's ruling: no old addresses kept.
   * A member's own room can go back to being called by their name in one press (`resetLabel`).
   *
   * It takes the name and two handlers, not a query, so the card that owns the room re-reads it.
   */
  import ActionDialog from "@magna-carta/design-system/action-dialog";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";
  import type { Failure } from "$lib/api/problem.ts";

  /** The longest name a room may have, as the server holds it. */
  const ROOM_NAME_MAXIMUM = 80;

  let {
    open = $bindable(false),
    heading,
    currentName,
    commitLabel = "Save",
    resetLabel,
    note,
    onSave,
    onReset,
  }: {
    open?: boolean;
    heading: string;
    /** The name the field starts with; empty for a new room. */
    currentName: string;
    commitLabel?: string;
    /** Offered where the room can go back to a name it was not given, with the act below. */
    resetLabel?: string;
    /** What saving does to the room's link, said under the field. */
    note: string;
    /** Save the name; answers with the refusal to show, or null when it was saved. */
    onSave: (name: string) => Promise<Failure | null>;
    onReset?: () => Promise<Failure | null>;
  } = $props();

  let typed = $state("");
  let failure = $state<Failure | null>(null);
  let resetting = $state(false);

  $effect(() => {
    if (open) {
      typed = currentName;
      failure = null;
    }
  });

  const cleaned = $derived(typed.replaceAll(/\s+/g, " ").trim());

  async function save(): Promise<ActionOutcome> {
    if (cleaned === "") return "refused";
    failure = await onSave(cleaned);
    return failure === null ? "committed" : "refused";
  }

  async function reset(): Promise<void> {
    if (onReset === undefined || resetting) return;
    resetting = true;
    failure = await onReset();
    resetting = false;
    if (failure === null) open = false;
  }
</script>

<ActionDialog
  bind:open
  kind="form"
  {heading}
  {commitLabel}
  commitBusyLabel="Saving"
  commitRefusal={cleaned === "" ? "Type a name first." : undefined}
  unsavedChanges={cleaned !== "" && cleaned !== currentName}
  onCommit={save}
>
  {#snippet notice()}
    {#if failure !== null}
      <FailureNotice
        {failure}
        subject="The room"
        title="The Name Did Not Change"
        fallback="The room kept its name."
        whenSilent="Couldn't connect. The room kept its name. Try again."
      />
    {/if}
  {/snippet}
  {#snippet fields()}
    <div class="flex flex-col gap-8">
      <Label for="room-name">Name</Label>
      <Input id="room-name" bind:value={typed} maxlength={ROOM_NAME_MAXIMUM} autocomplete="off" />
    </div>
    <p class="text-sm text-text-muted">{note}</p>
    {#if resetLabel !== undefined && onReset !== undefined}
      <div>
        <Button variant="secondary" size="sm" disabled={resetting} onclick={() => void reset()}>
          {resetLabel}
        </Button>
      </div>
    {/if}
  {/snippet}
</ActionDialog>
