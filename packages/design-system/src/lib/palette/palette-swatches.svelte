<script lang="ts">
  /*
   * PaletteSwatches — the row of colour squares a member picks from when they colour something they
   * own: a folder in the file manager, a calendar on the firm's grid.
   *
   * It exists because the second surface to need a colour picker is the moment the first one's
   * markup starts being copied. The file manager's swatches live inside its context menu and are
   * that menu's items; a calendar's rail has no menu to put them in, and a rail that hand-built its
   * own squares would be eleven fills and a check mark decided twice. So the SQUARES are here, in
   * one component, and each surface seats them wherever it seats them.
   *
   * A SWATCH HAS NO TEXT, so its accessible name is the colour's own (`aria-label`) and the chosen
   * one is marked inside the square, in whichever ink reads against that square's fill. The row is
   * a group of buttons rather than a radio group: a colour is applied on the press, not staged and
   * committed, and there is no state in which nothing is chosen.
   */
  import Check from "@lucide/svelte/icons/check";
  import { mergeClasses } from "../internal/merge-classes.ts";
  import { PALETTE_COLORS, type PaletteColor, type PaletteColorName } from "./index.ts";

  let {
    colors = PALETTE_COLORS,
    value,
    label,
    disabled = false,
    onchoose,
    class: className,
  }: {
    /** The colours offered, in the order they render. The whole palette by default. */
    colors?: readonly PaletteColor[];
    /** The colour currently chosen, where one is. */
    value?: PaletteColorName;
    /** What the row of swatches is, as a screen reader meets it: "Calendar colour". */
    label: string;
    disabled?: boolean;
    onchoose: (color: PaletteColorName) => void;
    class?: string;
  } = $props();
</script>

<div
  role="group"
  aria-label={label}
  class={mergeClasses("mc-palette-swatches", className)}
>
  {#each colors as color (color.name)}
    <button
      type="button"
      class="mc-palette-swatch"
      data-palette-color={color.name}
      data-palette-ink={color.ink}
      aria-label={color.label}
      aria-pressed={value === color.name}
      {disabled}
      onclick={() => onchoose(color.name)}
    >
      {#if value === color.name}
        <Check class="mc-palette-swatch-check" aria-hidden="true" />
      {/if}
    </button>
  {/each}
</div>
