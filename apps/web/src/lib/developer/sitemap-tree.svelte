<script lang="ts">
  /*
   * The Sitemap tree — a list of nodes, each rendered by sitemap-node.svelte (which recurses back
   * here for its children). Split from the node so every node owns its own expand/collapse state.
   */
  import type { SitemapNode as SitemapNodeData } from "./sitemap.ts";
  import SitemapNode from "./sitemap-node.svelte";

  let { nodes }: { nodes: readonly SitemapNodeData[] } = $props();
</script>

<ul class="flex flex-col gap-1">
  {#each nodes as node (node.path)}
    <li><SitemapNode {node} /></li>
  {/each}
</ul>
