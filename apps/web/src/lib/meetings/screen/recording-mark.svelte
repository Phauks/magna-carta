<script lang="ts">
  /*
   * The Recording mark: a filled dot and the word, in the header of every screen somebody in the
   * room is looking at, for exactly as long as the recording runs.
   *
   * IT IS HALF OF THE CONSENT MECHANISM, so it is drawn to be read rather than noticed. The word is
   * on the screen, not only in a hover or a label, because a member glancing up from a document has
   * to be able to answer "is this being recorded" without pointing at anything; and the dot is the
   * glyph every recording device in the world draws, filled, in the danger register's subtle pill —
   * the calm register, because the mark STAYS, and the banner and the live region are what interrupt.
   *
   * STATIC, ON PURPOSE. Nothing about it moves, so there is nothing for a reduced-motion preference
   * to take away: a pulsing dot that stopped pulsing for some readers would be two marks, and a mark
   * that draws the eye every second for an hour is a mark people learn to stop seeing.
   *
   * IT TAKES NO STATE. Whether to draw it is the caller's, read off what the room announced; a
   * component that decided would be a second place the rule "the room's frame lights the mark" is
   * written.
   */
  import Circle from "@lucide/svelte/icons/circle";
  import Badge from "@magna-carta/design-system/badge";
</script>

<Badge variant="danger" caps data-recording-mark="">
  <Circle class="size-8 fill-current" aria-hidden="true" />
  Recording
</Badge>
