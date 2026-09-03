<script lang="ts">
  /*
   * DetailsPanel.Facts — a definition list of figures, which is what a details panel mostly is.
   *
   * `ruled` gives it the same rule-and-inset a Section carries, for the run of facts that follows
   * another block rather than opening the body. The two spellings were the difference between the
   * four panels' copies more often than anything else in them.
   */
  import { mergeClasses } from "@magna-carta/design-system/internal/merge-classes";
  import type { Snippet } from "svelte";

  let {
    ruled = false,
    children,
  }: {
    /** Separate this run from what precedes it, the way a Section is separated. */
    ruled?: boolean;
    children: Snippet;
  } = $props();
</script>

<dl class={mergeClasses("flex flex-col gap-4 text-sm", ruled && "border-t border-border-default pt-12")}>
  {@render children()}
</dl>
