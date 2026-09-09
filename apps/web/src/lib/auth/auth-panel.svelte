<script lang="ts">
  /*
   * The card every signed-out screen is cut from: one measure, one heading position, one way back.
   *
   * BACK SITS ABOVE THE HEADING, quiet and small. It is a way out, not an action competing with the
   * primary button, so it renders below body size at normal weight — but it is a real control, with
   * a hit area that does not depend on the length of the word. Putting it above the heading rather
   * than at the foot of the card means the heading lands in the same place on every screen whether
   * or not there is anywhere to go back to.
   *
   * ITS LABEL NAMES THE DESTINATION AND NOTHING ELSE — "Sign In", "Your Choices" — never "Back to
   * sign in" (owner correction, 2026-09-09). The chevron already says "back"; repeating it in words
   * spends the widest part of the control on the one thing the icon cannot get wrong, and buries
   * the place you are actually going at the end of a sentence.
   *
   * Notices about the primary action belong BELOW it, in the caller's own content, so the card grows
   * downward and the button never moves. Nothing is reserved: holding empty space to keep a control
   * still buys stillness with a permanent dead gap on every screen that is not currently failing.
   */
  import type { Snippet } from "svelte";
  import ChevronLeft from "@lucide/svelte/icons/chevron-left";
  import * as Card from "@magna-carta/design-system/card";
  import * as Masthead from "@magna-carta/design-system/masthead";

  let {
    title,
    back,
    backLabel = "Back",
    meta,
    eyebrow,
    children,
    footer,
  }: {
    title: string;
    /** Called when the visitor steps back. Omit on a screen with nowhere to return to. */
    back?: () => void;
    /** The destination, named as a place: "Sign In", "Your Code". Never prefixed with "Back to". */
    backLabel?: string;
    /** The line under the heading — who is signing in, which channel a code came from. */
    meta?: Snippet;
    /** A badge above the heading, for a screen that is a step within a longer act. */
    eyebrow?: Snippet;
    children: Snippet;
    footer?: Snippet;
  } = $props();
</script>

<Card.Root class="relative w-full max-w-sm bg-surface-default shadow-elevation-2">
  <Card.Content class="flex flex-col gap-24">
    <div class="flex flex-col gap-4">
      {#if back}
        <button
          type="button"
          onclick={back}
          class="-ms-4 inline-flex min-h-32 items-center gap-4 self-start rounded-sm ps-4 pe-8 text-sm text-text-subtle hover:text-text-link hover:underline focus-visible:text-text-link focus-visible:outline-2 focus-visible:outline-focus-ring focus-visible:outline-offset-2"
        >
          <ChevronLeft size={15} aria-hidden="true" />
          {backLabel}
        </button>
      {/if}
      <Masthead.Heading>
        {#if eyebrow}<div>{@render eyebrow()}</div>{/if}
        <Masthead.Title class="text-2xl">{title}</Masthead.Title>
        {#if meta}<Masthead.Meta>{@render meta()}</Masthead.Meta>{/if}
      </Masthead.Heading>
    </div>

    {@render children()}
  </Card.Content>

  {#if footer}
    <Card.Footer class="flex-col items-start gap-4 text-xs text-text-muted">
      {@render footer()}
    </Card.Footer>
  {/if}
</Card.Root>
