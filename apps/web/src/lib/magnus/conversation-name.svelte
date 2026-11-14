<script lang="ts">
  /*
   * A conversation's name, edited where it is read.
   *
   * At rest the name is a line of text. Pressing it, or Rename in the conversation's menu, puts a
   * field in the name's own place, at the same height, holding the current name: Enter commits, Escape cancels,
   * and leaving the field commits too, because a name somebody typed and then clicked away from is
   * a name they meant. Nothing else on the row moves while it happens. The owner's ruling
   * (docs/conventions/magnus-rulings.md, R3) closed the earlier shape, which swapped the whole head
   * row for a labelled field and two buttons: a mode the header entered, rather than an edit of the
   * name.
   *
   * A FAILED RENAME KEEPS THE OLD NAME AND SAYS SO. The field closes, the name on screen is the one
   * the record still holds, and the notice beneath states what did not happen with the way to try
   * again. Nothing on screen ever shows a name the server refused.
   *
   * An empty commit clears the name: the conversation goes back to reading by the instant it
   * started, which is the same act the record calls a null title.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Input from "@magna-carta/design-system/input";
  import FailureNotice from "$lib/diagnostics/failure-notice.svelte";
  import { stated, type StatedFailure } from "$lib/diagnostics/failure-view.ts";
  import {
    conversationDisplayName,
    newWriteKey,
    renameConversation,
    type MagnusConversation,
  } from "./magnus-api.ts";

  let {
    conversation,
    disabled = false,
    onRenamed,
  }: {
    /** The conversation whose name this is. Null while none is open, which draws the resting name only. */
    conversation: MagnusConversation | null;
    disabled?: boolean;
    /** Called after the server accepted the new name, so the rail can read the record again. */
    onRenamed: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state("");
  let committing = $state(false);
  let failure = $state<StatedFailure | null>(null);
  let field = $state<HTMLInputElement | null>(null);

  const name = $derived(conversation === null ? "This conversation" : conversationDisplayName(conversation));

  /** Open the edit where the name stands. The conversation's menu calls this for its Rename. */
  export function rename(): void {
    begin();
  }

  function begin(): void {
    if (conversation === null || disabled || committing) return;
    draft = conversation.title ?? "";
    failure = null;
    editing = true;
    // The field mounts on the next frame; focusing it then selects the name so typing replaces it.
    queueMicrotask(() => {
      field?.focus();
      field?.select();
    });
  }

  function cancel(): void {
    editing = false;
    draft = "";
  }

  async function commit(): Promise<void> {
    if (!editing || conversation === null) return;
    const title = draft.trim();
    const current = conversation.title ?? "";
    editing = false;
    // The same name is not a rename, and a write that changes nothing would still audit one.
    if (title === current.trim()) return;
    committing = true;
    const outcome = await renameConversation(
      fetch,
      conversation.id,
      title === "" ? null : title,
      newWriteKey(),
    );
    committing = false;
    if (outcome.kind !== "ok") {
      failure = stated(
        outcome.failure,
        "The conversation wasn't renamed.",
        "Couldn't connect. The conversation wasn't renamed. Try again.",
      );
      return;
    }
    failure = null;
    onRenamed();
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      void commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  <div class="flex min-w-0 items-center gap-4">
    {#if editing}
      <Input
        bind:ref={field}
        bind:value={draft}
        size="sm"
        aria-label="Conversation name"
        class="w-2xs"
        onkeydown={keydown}
        onblur={() => void commit()}
      />
    {:else}
      <!-- The name is the control: pressing it opens the edit where the name stands. It is a ghost
           button so it reads as text at rest and as a control on hover, which is what "edited where it
           is read" asks for. -->
      <Masthead.Title level={2} class="min-w-0 truncate text-lg">
        <button
          type="button"
          class="max-w-full truncate rounded-sm text-start hover:bg-surface-sunken disabled:cursor-default disabled:hover:bg-transparent"
          disabled={conversation === null || disabled || committing}
          onclick={begin}
          title={conversation === null ? undefined : `${name}. Press to rename.`}
        >
          {committing ? draft || name : name}
        </button>
      </Masthead.Title>
    {/if}
  </div>
  {#if failure !== null}
    <FailureNotice
      failure={failure.failure}
      title="Nothing Changed"
      fallback={failure.fallback}
      whenSilent={failure.whenSilent}
      onRetry={begin}
    />
  {/if}
</div>
