<script lang="ts">
  /*
   * One tool as a card tile. A `ready` tool's whole tile links to its page; below `ready` the
   * tile is inert and quieter, its maturity badge carrying the "not yet" meaning — no disabled
   * styling that would read as broken. Every tool is `soon` until its page is built.
   */
  import type { Component } from "svelte";
  import type { ToolManifest } from "@magna-carta/tools/types";
  import * as Card from "@magna-carta/design-system/card";
  import MaturityBadge from "$lib/maturity/maturity-badge.svelte";
  import type { ToolPresentation } from "./tool-presentation.ts";

  let {
    tool,
    presentation,
    icon: Icon,
  }: { tool: ToolManifest; presentation: ToolPresentation; icon: Component } = $props();

  const launchable = $derived(presentation.stage === "ready");
</script>

{#snippet body()}
  <Card.Root class="h-full">
    <Card.Header>
      <div class="flex items-start justify-between gap-8">
        <span class="flex items-center gap-8">
          <Icon class="size-16 text-text-muted" aria-hidden="true" />
          <Card.Title>{tool.name}</Card.Title>
        </span>
        <MaturityBadge stage={presentation.stage} />
      </div>
      <Card.Description>{presentation.description}</Card.Description>
    </Card.Header>
  </Card.Root>
{/snippet}

{#if launchable}
  <a href={`/tools/${tool.id}`} class="block h-full rounded-lg hover:bg-surface-raised">{@render body()}</a>
{:else}
  <div class="h-full">{@render body()}</div>
{/if}
