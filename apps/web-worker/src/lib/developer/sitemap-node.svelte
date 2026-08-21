<script lang="ts">
  /*
   * One Sitemap node: a caret to expand/collapse when it has children, then either a link (a real
   * page) or a plain toggle label (an intermediate segment with no page of its own, e.g.
   * "settings"). A leaf reserves the caret's width so its label lines up under its siblings.
   * Recurses into the tree for its children.
   */
  import type { SitemapNode } from "./sitemap.ts";
  import { openDevPage } from "./open-dev-page.ts";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import SitemapTree from "./sitemap-tree.svelte";

  let { node }: { node: SitemapNode } = $props();

  const hasChildren = $derived(node.children.length > 0);
  let expanded = $state(true);

  const caretClasses =
    "size-16 shrink-0 text-text-muted transition-transform duration-fast ease-standard";
  const rowText = "grow rounded-md px-4 py-4 text-start text-sm";
</script>

{#if node.href}
  {@const href = node.href}
  <div class="flex items-center gap-2">
    {#if hasChildren}
      <button
        type="button"
        class="flex shrink-0 items-center rounded"
        aria-expanded={expanded}
        aria-label="{expanded ? 'Collapse' : 'Expand'} {node.segment}"
        onclick={() => (expanded = !expanded)}
      >
        <ChevronRight class="{caretClasses} {expanded ? 'rotate-90' : ''}" aria-hidden="true" />
      </button>
    {:else}
      <span class="size-16 shrink-0" aria-hidden="true"></span>
    {/if}
    <a {href} onclick={(event) => openDevPage(event, href)} class="{rowText} hover:bg-surface-sunken">
      {node.segment}
    </a>
  </div>
{:else if hasChildren}
  <button
    type="button"
    class="flex w-full items-center gap-2 rounded-md hover:bg-surface-sunken"
    aria-expanded={expanded}
    onclick={() => (expanded = !expanded)}
  >
    <ChevronRight class="{caretClasses} {expanded ? 'rotate-90' : ''}" aria-hidden="true" />
    <span class="{rowText} font-medium text-text-muted">{node.segment}</span>
  </button>
{:else}
  <div class="flex items-center gap-2">
    <span class="size-16 shrink-0" aria-hidden="true"></span>
    <span class="{rowText} text-text-muted">{node.segment}</span>
  </div>
{/if}

{#if hasChildren && expanded}
  <div class="ms-12 border-s border-border-default ps-8">
    <SitemapTree nodes={node.children} />
  </div>
{/if}
