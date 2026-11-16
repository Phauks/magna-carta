<script lang="ts">
  /*
   * PlacementBoard.Root — a rectangle at its true proportion, scaled to the width it is given, on
   * which things are placed at positions stated in the caller's own whole units.
   *
   * WHY A BOARD AND NOT A CANVAS ELEMENT. Everything on it is a real element: a box a reader can
   * Tab to and move with the arrow keys, a caption a screen reader reads, a forbidden band whose
   * name is text. A drawn canvas would have had to rebuild all of that and would still be a picture.
   *
   * DOMAIN-BLIND. It knows a width, a height, an optional picture to lay things over and an optional
   * band along the bottom where nothing may go. What the units are (thousandths of an inch on a
   * check, pixels of a photograph) and what the boxes mean are the caller's.
   *
   * THE PROPORTION IS AN INLINE STYLE, and so is every position on it. A share of the board is not a
   * design value a token could hold, the same reason the time grid's blocks are placed inline.
   * Text inside a box is sized against the board's width (container units), so a check drawn at
   * half size reads at half size rather than overflowing its boxes.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import { setPlacementBoardContext } from "./placement-board-context.ts";
  import { shareOf } from "./placement-board-model.ts";

  let {
    width,
    height,
    label,
    image,
    band,
    class: className,
    children,
    ...restProps
  }: Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
    /** The board's width, in the caller's whole units. */
    width: number;
    /** The board's height, in the same units. */
    height: number;
    /** The board's accessible name. */
    label: string;
    /** A picture laid under everything, stretched to the board (already straightened). */
    image?: string | null;
    /** A band from `from` to the bottom edge where nothing may be placed, named by `label`. */
    band?: { readonly from: number; readonly label: string } | null;
    /** The things placed on the board. */
    children?: Snippet;
  } = $props();

  let element = $state<HTMLDivElement | null>(null);

  setPlacementBoardContext({
    width: () => width,
    height: () => height,
    element: () => element,
  });

  const minted = $props.id();
  const patternIdentifier = `placement-board-band-${minted}`;
</script>

<div
  bind:this={element}
  role="group"
  aria-label={label}
  class={mergeClasses("mc-placement-board w-full", className)}
  style="aspect-ratio: {width} / {height}"
  {...restProps}
>
  {#if image}
    <img class="mc-placement-board-image size-full" src={image} alt="" draggable="false" />
  {/if}
  {#if band}
    <div
      class="mc-placement-board-band w-full"
      style="inset-block-start: {shareOf(band.from, height)}; block-size: {shareOf(
        height - band.from,
        height,
      )}"
    >
      <svg class="mc-placement-board-band-hatch size-full" aria-hidden="true">
        <defs>
          <pattern
            id={patternIdentifier}
            width="10"
            height="10"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line class="mc-placement-board-band-line" x1="0" y1="0" x2="0" y2="10" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#{patternIdentifier})" />
      </svg>
      <span class="mc-placement-board-band-label">{band.label}</span>
    </div>
  {/if}
  {@render children?.()}
</div>
