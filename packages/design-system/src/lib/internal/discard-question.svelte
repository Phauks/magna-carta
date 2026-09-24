<script lang="ts">
  /*
   * The question a close gesture asks while there is unsaved work — the one the whole product asks,
   * rendered in one place.
   *
   * It names what would be lost and offers GOING BACK TO IT FIRST, because the reader who arrives
   * here by pressing Escape meant to dismiss something smaller than their own typing. The keep is
   * therefore the quiet control at the weak hand and the discard is the deliberate one, which is
   * the reverse of the emphasis a footer usually carries and is the point.
   *
   * THE VERBS ARE THIS COMPONENT'S AND THE SENTENCE IS THE SURFACE'S. "Keep Editing" and "Discard
   * Changes" mean the same thing wherever this question is asked, so a surface cannot reword them;
   * WHAT would be lost differs between a record being changed and a form being filled, so that one
   * line is the caller's. Same division the record window draws around its own menu: the place and
   * the shape here, the content there.
   *
   * It is an AlertDialog rather than a Dialog on purpose — this is a decision with no incidental
   * dismiss, so there is no corner ✕ and a press outside does not answer it. A question that can be
   * dismissed by a stray press is not a question.
   */
  import * as AlertDialog from "../components/alert-dialog/index.ts";
  import { buttonClasses } from "../components/button/index.ts";
  import type { CloseGuard } from "./close-guard.svelte.ts";

  let {
    guard,
    title = "Discard Your Changes?",
    description,
    onDiscard,
  }: {
    /** The guard whose pending gesture this question is about. */
    guard: CloseGuard;
    /** The heading. Defaulted, because the question is the same question wherever it is asked. */
    title?: string;
    /**
     * The one line naming what would be lost, in the surface's own words — or nothing, where the
     * heading already says it all. A form being filled asks with no line under the question.
     */
    description?: string;
    /** Carry out the gesture the guard was holding. Called only when the reader chooses to discard. */
    onDiscard: () => void;
  } = $props();
</script>

<AlertDialog.Root
  bind:open={
    () => guard.asking,
    (showing) => {
      // Only the closing direction is meaningful here: the question is opened by the guard raising
      // a pending gesture, never by this binding. Bits reports the close (Escape, the Cancel part),
      // and that is the reader keeping their work.
      if (!showing) guard.dismiss();
    }
  }
>
  <AlertDialog.Content data-modal-shell="discard-question">
    <AlertDialog.Title>{title}</AlertDialog.Title>
    {#if description !== undefined}
      <AlertDialog.Description>{description}</AlertDialog.Description>
    {/if}
    <!-- The row is layout, so it rides utilities rather than a recipe of its own. The panel is
         already a flex column with its own gap; the extra top margin is what sets this question's
         answer apart from the sentence above it, and it is carried over from the record window's
         own version unchanged so the extraction moves no pixels. -->
    <div class="mt-16 flex items-center justify-end gap-8">
      <AlertDialog.Cancel class={buttonClasses({ variant: "ghost", size: "default" })}>
        Keep Editing
      </AlertDialog.Cancel>
      <AlertDialog.Action
        class={buttonClasses({ variant: "secondary", size: "default" })}
        onclick={onDiscard}
      >
        Discard Changes
      </AlertDialog.Action>
    </div>
  </AlertDialog.Content>
</AlertDialog.Root>
