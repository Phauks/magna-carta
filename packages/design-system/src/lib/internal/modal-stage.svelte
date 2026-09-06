<script lang="ts">
  /*
   * ModalStage — the box every modal panel renders inside, and the one home of its markup.
   *
   * Both Dialog.Content and AlertDialog.Content wrap Bits' panel in this rather than each writing
   * the same div, so the stage's classes, its diagnostic attribute and the reason it carries the
   * modal z-layer are stated once. What the stage does — the gutter, the centring, the height cap,
   * dropping the gutter for an expanded panel — is the recipe's (styles/recipes/modal-stage.css);
   * this component only puts it in the tree.
   *
   * It carries the modal z-layer itself, not only the panel inside it: a fixed box is a stacking
   * context of its own, so a z-index on the panel alone would leave it beneath the scrim.
   */
  import type { Snippet } from "svelte";
  import { Z_LAYER_CLASSES } from "./floating.ts";
  import { mergeClasses } from "./merge-classes.ts";

  let { children }: { children: Snippet } = $props();
</script>

<div data-modal-stage="" class={mergeClasses(Z_LAYER_CLASSES.modal, "mc-modal-stage")}>
  {@render children()}
</div>
