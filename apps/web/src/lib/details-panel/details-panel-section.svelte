<script lang="ts">
  /*
   * DetailsPanel.Section — a named group inside the body, separated from what precedes it by a
   * rule rather than by a gap alone.
   *
   * The name is a FieldLabel, which is the platform's one label voice. Passing the label as a
   * string rather than a snippet is deliberate: a section name is a name, and a section that wanted
   * markup in its heading would be a section doing something this shell should not quietly allow.
   */
  import FieldLabel from "@magna-carta/design-system/field-label";
  import type { Snippet } from "svelte";

  let {
    label,
    children,
  }: {
    /** What the group is called. */
    label: string;
    children: Snippet;
  } = $props();
</script>

<section class="flex flex-col gap-8 border-t border-border-default pt-12">
  <FieldLabel as="h3">{label}</FieldLabel>
  {@render children()}
</section>
