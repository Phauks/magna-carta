<script lang="ts">
  /*
   * MAGNUS — the member's own workspace for the assistant.
   *
   * It is a PLACE, where the matter's Magnus section is a section of a record, and that difference
   * is the whole reason there are two of them. Here the reader asks "what did I ask, and what do I
   * want to ask now": every conversation they have had, across everything, newest first, each
   * citing the matter its transcript is kept on when it is kept on one. A conversation started here
   * belongs to no matter.
   *
   * The rail and the transcript are one component with the matter's section (magnus-surface.svelte),
   * so a conversation reads and behaves the same wherever it is opened, and neither screen knows
   * the other exists.
   *
   * NEW starts nothing on its own: it clears the transcript and puts the cursor in the composer, and
   * the record is written when the first question is actually asked. Nothing generates a title, so
   * a conversation nobody names reads by the instant it started.
   */
  import MagnusSurface from "$lib/magnus/magnus-surface.svelte";

</script>

<svelte:head>
  <title>Magnus · Magna Carta</title>
</svelte:head>

<!-- The surface is the design system's two-sided screen and takes the whole canvas. The screen's
     name, New and the search head the rail, as the owner's board draws them. -->
<MagnusSurface
  subject="magnus"
  matterId={null}
  rail="column"
  showMatter
  emptyTitle="Nothing Asked Yet"
  emptyDescription="You haven't asked Magnus anything yet. Type a question below to start."
/>
