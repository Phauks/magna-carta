<script lang="ts">
  /*
   * One tool as a dense list row — the same content and launchable rule as the tile, laid out
   * on a single line: leading icon, name, descriptor trailing muted, maturity badge at the end.
   */
  import type { Component } from "svelte";
  import type { ToolManifest } from "@magna-carta/tools/types";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import { hasSurface } from "$lib/maturity/maturity.ts";
  import type { ToolPresentation } from "./tool-presentation.ts";

  let {
    tool,
    presentation,
    icon: Icon,
  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();

  const launchable = $derived(hasSurface(presentation.stage));
</script>

{#snippet body()}
  <div class="flex items-center gap-16 px-16 py-12">
    <Icon class="size-16 shrink-0 text-text-muted" aria-hidden="true" />
    <span class="font-medium">{tool.name}</span>
    <span class="truncate text-sm text-text-muted">{presentation.description}</span>
    <span class="ml-auto shrink-0"><MaturityBadge stage={presentation.stage} /></span>
  </div>
{/snippet}

{#if launchable}
  <a href={`/tools/${tool.id}`} class="block hover:bg-surface-raised">{@render body()}</a>
{:else}
  <div>{@render body()}</div>
{/if}
