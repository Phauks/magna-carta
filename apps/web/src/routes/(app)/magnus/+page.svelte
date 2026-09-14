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
  import CreateControl from "@magna-carta/design-system/create-control";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import MagnusSurface from "$lib/magnus/magnus-surface.svelte";

  let surface = $state<ReturnType<typeof MagnusSurface> | null>(null);

  /*
   * Why New cannot be pressed, answered by the surface's availability read and carried by the
   * control in the header. It starts refused rather than live, because the read has not landed on
   * the first frame and a control that is briefly pressable and inert is the defect this closes:
   * with the firm's gates shut there is no composer on the page to put a cursor in, so a press
   * would clear some state, focus nothing, and say nothing about why.
   */
  let createRefusal = $state<string | undefined>(
    "Whether Magnus can be used here has not been read yet.",
  );
</script>

<svelte:head>
  <title>Magnus · Magna Carta</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col gap-16">
  <MagnusSurface
    bind:this={surface}
    bind:createRefusal
    subject="magnus"
    matterId={null}
    rail="column"
    showMatter
    emptyTitle="Nothing Asked Yet"
    emptyDescription="You have not asked Magnus anything. Type a question below to start a conversation."
  >
    <!-- The surface owns the search because it owns the read the search narrows; this screen owns
         where it sits, which is the action row every other Workspace screen keeps its search in.
         The search leads and the create control follows: the field grows toward the inline start as
         it opens, so New never moves under the pointer. -->
    {#snippet screenHeader(controls)}
      <ScreenHeader title="Magnus">
        {#snippet actions()}
          {@render controls()}
          <CreateControl
            title="Start a conversation with Magnus, on no matter."
            refusal={createRefusal}
            onpress={() => surface?.startNew()}
          />
        {/snippet}
      </ScreenHeader>
    {/snippet}
  </MagnusSurface>
</div>
