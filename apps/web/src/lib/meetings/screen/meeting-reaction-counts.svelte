<script lang="ts">
  /*
   * What a room too large to attribute sends instead of bubbles: a short row of glyph-and-count.
   *
   * WHAT COALESCING COSTS IS ATTRIBUTION, AND THIS IS THE HONEST TRADE. Above the roster's own
   * threshold the gallery draws sixteen of three hundred faces, so a bubble on the right face is a
   * promise the screen cannot keep for most of the room. What a reader gets instead is the number,
   * which is the thing that is actually true at that size: eleven people applauded.
   *
   * IT IS NOT ANNOUNCED. A stream of changing counts read out once a second is noise rather than
   * information, so the strip is hidden from a reader and the reactions control's own label is how
   * the capability is reached. A RAISED HAND is the opposite and is announced at every room size —
   * that one is a request for the floor.
   */
  import MeetingReactionMark from "./meeting-reaction-mark.svelte";
  import type { ReactionCount } from "$lib/meetings/client/reactions.svelte.ts";

  let {
    counts,
  }: {
    /** The second's counts, whole. Empty once the dwell has passed, which draws nothing at all. */
    counts: readonly ReactionCount[];
  } = $props();
</script>

{#if counts.length > 0}
  <span class="flex items-center gap-8" aria-hidden="true">
    {#each counts as entry (entry.name)}
      <span class="flex items-center gap-4">
        <MeetingReactionMark name={entry.name} />
        {entry.count}
      </span>
    {/each}
  </span>
{/if}
