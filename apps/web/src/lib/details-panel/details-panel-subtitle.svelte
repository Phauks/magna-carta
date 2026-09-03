<script lang="ts">
  /*
   * DetailsPanel.Subtitle — the one quiet line under the title: a record's number, what a selection
   * is made of, or the sentence that tells a reader what selecting something would do.
   *
   * `numeric` puts it in tabular figures, which is what an entry number wants and a sentence does
   * not.
   */
  import { mergeClasses } from "@magna-carta/design-system/internal/merge-classes";
  import type { Snippet } from "svelte";

  let {
    numeric = false,
    title,
    children,
  }: {
    /** Tabular figures, for a line that is a number rather than a sentence. */
    numeric?: boolean;
    /** A hover explanation, where the line stands in for a fact the platform cannot serve yet. */
    title?: string;
    children: Snippet;
  } = $props();
</script>

<p class={mergeClasses("text-xs text-text-muted", numeric && "tabular-nums")} {title}>
  {@render children()}
</p>
