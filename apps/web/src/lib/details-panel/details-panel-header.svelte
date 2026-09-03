<script lang="ts">
  /*
   * DetailsPanel.Header — the panel's own masthead: what is being shown, one quiet line under it,
   * and the acts that belong to the header rather than to the body.
   *
   * The title block takes the width and the actions sit at the inline end, so a long entry number
   * truncates rather than pushing the close control off the edge. A face with no actions renders
   * the same row with one child in it, which lands identically — one grammar, not two.
   */
  import type { Snippet } from "svelte";

  let {
    children,
    actions,
  }: {
    /** The title and its subtitle. */
    children: Snippet;
    /** Header controls, in reading order. The close control goes last. */
    actions?: Snippet;
  } = $props();
</script>

<header class="flex items-start gap-8 border-b border-border-default p-12">
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
  {@render actions?.()}
</header>
