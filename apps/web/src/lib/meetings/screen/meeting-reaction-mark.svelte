<script lang="ts" module>
  /*
   * ONE REACTION, DRAWN — and the one table that says which glyph draws which name.
   *
   * THE WIRE CARRIES THE MEANING AND THIS FILE CHOOSES THE PICTURE, which is why the two lists are
   * separate. Lucide renames its glyphs between releases — the face pinned here as `laugh` has
   * already been renamed upstream — so a protocol that named icons would make upgrading the drawing
   * a change to the wire. Re-choosing a drawing is a line in this table and nothing else.
   *
   * TWO OF THE SIX ARE NEAREST MATCHES RATHER THAN THE OBVIOUS PICTURE, and both are deliberate.
   * The pinned icon set ships no clapping glyph, so applause is a HAND OFFERED (`hand-heart`); the
   * nearest alternative is a film slate, which would read as recording in a product that is about
   * to ship recording for real. And two glyphs that would have been obvious are already spoken for
   * elsewhere in this product — `sparkles` is the Assistant and `star` is a favourite — so neither
   * is used here, because the same mark meaning two things one screen apart is worse than a
   * second-best picture.
   */
  import Heart from "@lucide/svelte/icons/heart";
  import HandHeart from "@lucide/svelte/icons/hand-heart";
  import Laugh from "@lucide/svelte/icons/laugh";
  import PartyPopper from "@lucide/svelte/icons/party-popper";
  import ThumbsDown from "@lucide/svelte/icons/thumbs-down";
  import ThumbsUp from "@lucide/svelte/icons/thumbs-up";
  import type { MeetingReaction } from "$lib/meetings/client/reactions.svelte.ts";
  import type { Component } from "svelte";

  /** The glyph each name is drawn as. Closed, like the vocabulary it is keyed by. */
  const REACTION_GLYPHS: Readonly<Record<MeetingReaction, Component>> = {
    "thumbs-up": ThumbsUp,
    "thumbs-down": ThumbsDown,
    heart: Heart,
    laugh: Laugh,
    applause: HandHeart,
    celebrate: PartyPopper,
  } as Readonly<Record<MeetingReaction, Component>>;

  export function reactionGlyph(name: MeetingReaction): Component {
    return REACTION_GLYPHS[name];
  }
</script>

<script lang="ts">
  import Badge from "@magna-carta/design-system/badge";
  import { REACTION_DWELL_STYLE } from "$lib/meetings/client/reactions.svelte.ts";

  let {
    name,
    rising = false,
  }: {
    name: MeetingReaction;
    /**
     * Whether this mark is one somebody just threw, rather than an item in a menu or an entry in
     * the counts strip. A rising mark carries the design system's own reaction motion and the
     * dwell the client decided; everything else draws the same glyph and holds still.
     */
    rising?: boolean;
  } = $props();

  const Glyph = $derived(reactionGlyph(name));
</script>

{#if rising}
  <!-- The motion is the design system's recipe, not a style written here, and it is handed the one
       number only the browser knows: how long a reaction is worth looking at. Under reduced motion
       the recipe holds the mark still for the same dwell and fades it where it is. -->
  <span class="mc-reaction-rise" style={REACTION_DWELL_STYLE}>
    <Badge variant="neutral">
      <Glyph class="size-16" aria-hidden="true" />
    </Badge>
  </span>
{:else}
  <Glyph class="size-16" aria-hidden="true" />
{/if}
