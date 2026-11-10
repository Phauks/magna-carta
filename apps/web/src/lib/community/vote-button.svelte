<script lang="ts">
  /*
   * The vote control on a request. It shows the count, or "<5" while fewer than five people have
   * voted: the board withholds an exact small count so an early post cannot reveal which firm voted.
   * It never lists who voted — there is nothing to list from, because no read returns voters.
   */
  import ChevronUp from "@lucide/svelte/icons/chevron-up";
  import { VOTE_DISPLAY_FLOOR } from "@magna-carta/community/vocabulary";

  let {
    voteCount,
    firmVoteCount,
    voted,
    disabled = false,
    size = "default",
    onToggle,
  }: {
    /** Null below the display floor. */
    voteCount: number | null;
    firmVoteCount: number | null;
    voted: boolean;
    disabled?: boolean;
    size?: "default" | "large";
    onToggle?: () => void;
  } = $props();

  const countText = $derived(voteCount === null ? `<${VOTE_DISPLAY_FLOOR}` : String(voteCount));
  const caption = $derived(
    voted ? "Voted" : firmVoteCount === null ? "New" : `${firmVoteCount} firms`,
  );
</script>

<button
  type="button"
  aria-pressed={voted}
  aria-label={voted ? `Remove your vote, ${countText} votes` : `Vote, ${countText} votes`}
  {disabled}
  onclick={onToggle}
  class="flex shrink-0 flex-col items-center justify-center rounded-md border border-border-default bg-surface-default text-text-default tabular-nums hover:border-border-strong aria-pressed:border-action-primary aria-pressed:bg-surface-selected disabled:opacity-60 {size ===
  'large'
    ? 'w-64 py-8'
    : 'w-48 py-4'}"
>
  <ChevronUp class="size-16 text-text-muted" aria-hidden="true" />
  <span class="text-md font-semibold leading-tight">{countText}</span>
  <span class="text-xs text-text-subtle">{caption}</span>
</button>
