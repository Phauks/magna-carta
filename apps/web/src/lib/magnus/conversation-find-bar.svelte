<script lang="ts">
  /*
   * Finding words within the open conversation (the owner's ruling R2.6,
   * docs/conventions/magnus-rulings.md).
   *
   * It opens from the conversation's own menu, because the ruling put every act on a conversation
   * behind one `…`, and it stands under the conversation's name until it is closed. It steps between
   * the MESSAGES that hold the words, not between each occurrence: a message is what a reader is
   * looking for, and the transcript marks every occurrence inside it.
   *
   * Enter goes to the next message and Shift+Enter to the previous one, the way a browser's own find
   * does; Escape closes it. The count is announced as it changes, so a reader who cannot see the
   * transcript move still learns where they are.
   */
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import Search from "@lucide/svelte/icons/search";
  import X from "@lucide/svelte/icons/x";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import * as Tooltip from "@magna-carta/design-system/tooltip";

  let {
    value = $bindable(""),
    matchCount,
    current,
    reading = false,
    onStep,
    onClose,
  }: {
    /** What the reader typed. */
    value?: string;
    /** How many messages hold the words. */
    matchCount: number;
    /** Which of them is in view, from zero. */
    current: number;
    /** Earlier messages are still being read so the find reaches them too. */
    reading?: boolean;
    onStep: (step: 1 | -1) => void;
    onClose: () => void;
  } = $props();

  let field = $state<HTMLInputElement | null>(null);

  /** Put the caret in the field: the menu that opened the bar hands focus back to its own trigger. */
  export function focus(): void {
    field?.focus();
    field?.select();
  }

  const typed = $derived(value.trim() !== "");
  const status = $derived.by(() => {
    if (!typed) return "";
    if (reading) return "Reading the earlier messages";
    if (matchCount === 0) return "No messages match";
    return `${String(current + 1)} of ${String(matchCount)} ${matchCount === 1 ? "message" : "messages"}`;
  });

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (matchCount > 0) onStep(event.shiftKey ? -1 : 1);
    }
  }
</script>

<div class="flex min-w-0 flex-1 items-center gap-8" role="search" aria-label="Find in this conversation">
  <Search class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
  <Input
    bind:ref={field}
    bind:value
    size="sm"
    class="min-w-0 flex-1"
    aria-label="Words to find in this conversation"
    onkeydown={keydown}
  />
  <p class="shrink-0 text-xs text-text-muted tabular-nums" role="status">{status}</p>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          disabled={matchCount === 0}
          aria-label="Previous message that matches"
          onclick={() => onStep(-1)}
        >
          <ChevronUp class="size-16" aria-hidden="true" />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>Previous</Tooltip.Content>
  </Tooltip.Root>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          disabled={matchCount === 0}
          aria-label="Next message that matches"
          onclick={() => onStep(1)}
        >
          <ChevronDown class="size-16" aria-hidden="true" />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>Next</Tooltip.Content>
  </Tooltip.Root>
  <Tooltip.Root>
    <Tooltip.Trigger>
      {#snippet child({ props })}
        <Button
          {...props}
          variant="ghost"
          size="icon-sm"
          aria-label="Close find"
          onclick={onClose}
        >
          <X class="size-16" aria-hidden="true" />
        </Button>
      {/snippet}
    </Tooltip.Trigger>
    <Tooltip.Content>Close</Tooltip.Content>
  </Tooltip.Root>
</div>
