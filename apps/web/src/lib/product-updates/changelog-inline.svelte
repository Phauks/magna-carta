<script lang="ts">
  /*
   * A changelog entry's inline Markdown nodes, drawn as text (see changelog-text.ts). Bold and
   * emphasis nest, so the snippet calls itself rather than the component importing itself.
   */
  import type { ChangelogInline } from "./changelog-text.ts";

  let { nodes }: { nodes: readonly ChangelogInline[] } = $props();
</script>

{#snippet inline(children: readonly ChangelogInline[])}{#each children as node, nodeIndex (nodeIndex)}{#if node.kind === "text"}{node.text}{:else if node.kind === "code"}<code
        class="rounded-sm bg-surface-sunken px-4 font-mono text-xs whitespace-nowrap">{node.text}</code
      >{:else if node.kind === "strong"}<strong class="font-semibold"
        >{@render inline(node.children)}</strong
      >{:else}<em>{@render inline(node.children)}</em>{/if}{/each}{/snippet}

{@render inline(nodes)}
