<script lang="ts">
  /*
   * The maturity dot — the maturity mark where a labelled badge won't fit: an icon-only control
   * like the notification bell, a sidebar footer button, or a destination icon in the collapsed
   * rail. It carries the stage's colour (maturity.ts) and an accessible label, so its meaning is
   * never colour-only. The caller positions it (typically absolute, over the icon's top-right);
   * this owns only the dot's shape and colour. Renders nothing at "ready".
   */
  import { MATURITY_PRESENTATION, type MaturityStage } from "./maturity.ts";

  let { stage, class: className }: { stage: MaturityStage; class?: string } = $props();

  const presentation = $derived(MATURITY_PRESENTATION[stage]);
</script>

{#if presentation}
  <span
    class="inline-block size-8 shrink-0 rounded-full {className}"
    style="background-color: {presentation.dotColor}"
    role="img"
    aria-label="{presentation.label} — in development"
  ></span>
{/if}
