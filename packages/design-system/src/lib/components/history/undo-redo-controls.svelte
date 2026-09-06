<script lang="ts">
  /*
   * UndoRedoControls — the product's ONE pair of history controls, and the only place their
   * behaviour is written.
   *
   * EACH IS A SPLIT CONTROL: the button takes one step, and the caret fused to its side opens the
   * stack. A reader who changed five things and wants them all back can see the five and choose the
   * one to walk back to, rather than pressing Undo repeatedly and watching where it stops.
   *
   * NEITHER WEARS A BARE ARROW. Both the hover and the accessible name say what pressing will do —
   * "Undo moving 3 files to Discovery", not "Undo" — which is why the stack holds a label per step
   * rather than a bare depth. What each step WAS is said in the list, never on the strip.
   *
   * THE CONTROL DOES THE WALK; THE SURFACE SAYS WHAT HAPPENED. It calls the stack and hands the
   * outcome back through `onOutcome`, because the live region an announcement belongs in is the
   * surface's, and a control that spoke for itself would be a second voice on the same strip. The
   * outcome arrives once the inverses have answered, never when the stack popped.
   *
   * BOTH HALVES ARE HELD WHILE A WALK IS IN FLIGHT. A stack whose steps write to the server takes
   * real time, and a second press landing mid-walk would interleave two sequences of inverses.
   *
   * IT VARIES NOTHING. The pair lives in the counts strip on every surface that has a stack, and one
   * band wears one chrome: the ghost small square, like every other glyph control in the strip
   * (`docs/conventions/file-manager-rulings.md`, N31 and N32). It briefly took a `variant` so a
   * toolbar could dress it differently, which is precisely what that ruling is against — a control
   * taking its look from its caller is how one band ends up wearing two.
   *
   * THE HEADING SITS INSIDE A GROUP, WHICH IS NOT DECORATION. A GroupHeading with no Group above it
   * throws when the menu opens — the group is where the heading finds the identity it labels — and
   * the throw happens on the press rather than on render, so it is invisible until somebody opens
   * the dropdown. Both hand-built copies of this control shipped without it.
   */
  import ChevronDown from "@lucide/svelte/icons/chevron-down";
  import Redo2 from "@lucide/svelte/icons/redo-2";
  import Undo2 from "@lucide/svelte/icons/undo-2";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import Button, { buttonClasses } from "../button/index.ts";
  import * as DropdownMenu from "../dropdown-menu/index.ts";
  import type { HistoryOutcome, HistoryStack } from "./history-stack.svelte.ts";

  type Props = {
    /** The stack these controls walk. */
    history: HistoryStack;
    /**
     * What the walk did, once the inverses have answered. The surface announces it — usually
     * through `historyAnnouncement`, into whatever live region it already owns.
     */
    onOutcome?: (outcome: HistoryOutcome) => void;
    class?: string;
  };

  let { history, onOutcome, class: className }: Props = $props();

  // The caret is fused to the button: the button loses its trailing radius, the caret its leading
  // one, so the pair reads as one control with two halves rather than two controls that touch.
  const caretClasses = mergeClasses(
    buttonClasses({ variant: "ghost", size: "icon-sm" }),
    "rounded-s-none",
  );

  async function walk(direction: "undo" | "redo", steps: number): Promise<void> {
    const outcome = await (direction === "undo" ? history.undo(steps) : history.redo(steps));
    onOutcome?.(outcome);
  }
</script>

<span class={mergeClasses("flex items-center gap-4", className)} data-undo-redo-controls>
  <span class="inline-flex">
    <Button
      variant="ghost"
      size="icon-sm"
      class="rounded-e-none"
      disabled={!history.canUndo}
      title={history.undoTitle}
      aria-label={history.undoTitle}
      onclick={() => void walk("undo", 1)}
    >
      <Undo2 class="size-16" aria-hidden="true" />
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={caretClasses}
        disabled={!history.canUndo}
        title={history.undoStackTitle}
        aria-label="Undo history"
      >
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading>Undo, newest change first</DropdownMenu.GroupHeading>
          {#each history.undoLabels as label, index (index)}
            <DropdownMenu.Item onSelect={() => void walk("undo", index + 1)}>
              {index + 1}. {label}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </span>
  <span class="inline-flex">
    <Button
      variant="ghost"
      size="icon-sm"
      class="rounded-e-none"
      disabled={!history.canRedo}
      title={history.redoTitle}
      aria-label={history.redoTitle}
      onclick={() => void walk("redo", 1)}
    >
      <Redo2 class="size-16" aria-hidden="true" />
    </Button>
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        class={caretClasses}
        disabled={!history.canRedo}
        title={history.redoStackTitle}
        aria-label="Redo history"
      >
        <ChevronDown class="size-16" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Group>
          <DropdownMenu.GroupHeading>Redo, next change first</DropdownMenu.GroupHeading>
          {#each history.redoLabels as label, index (index)}
            <DropdownMenu.Item onSelect={() => void walk("redo", index + 1)}>
              {index + 1}. {label}
            </DropdownMenu.Item>
          {/each}
        </DropdownMenu.Group>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  </span>
</span>
