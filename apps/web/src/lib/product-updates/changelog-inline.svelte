<script lang="ts">
  /* An entry's inline Markdown nodes, drawn as text (see changelog-text.ts). */
  import type { ChangelogInline } from "./changelog-text.ts";
  import Self from "./changelog-inline.svelte";

  let { nodes }: { nodes: readonly ChangelogInline[] } = $props();
</script>

{#each nodes as node, nodeIndex (nodeIndex)}{#if node.kind === "text"}{node.text}{:else if node.kind === "code"}<code
      class="rounded-sm bg-surface-sunken px-4 font-mono text-xs whitespace-nowrap">{node.text}</code
    >{:else if node.kind === "strong"}<strong class="font-semibold"
      ><Self nodes={node.children} /></strong
    >{:else}<em><Self nodes={node.children} /></em>{/if}{/each}
