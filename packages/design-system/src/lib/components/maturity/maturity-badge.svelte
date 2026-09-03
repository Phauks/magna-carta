<script lang="ts">
  /*
   * The maturity badge — the labelled mark for a surface still maturing (a nav tab, a sidebar
   * row). Reads the shared model (maturity.ts), so "Alpha" reads the same wherever it appears.
   * Renders nothing at "ready": a finished surface wears no mark.
   */
  import Badge from "../badge/index.ts";
  import { MATURITY_PRESENTATION, type MaturityStage } from "./maturity.ts";

  let { stage, class: className }: { stage: MaturityStage; class?: string } = $props();

  const presentation = $derived(MATURITY_PRESENTATION[stage]);
</script>

{#if presentation}
  <Badge variant={presentation.badgeVariant} class={className}>{presentation.label}</Badge>
{/if}
