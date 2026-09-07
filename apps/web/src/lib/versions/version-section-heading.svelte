<script lang="ts">
  /*
   * ONE FOLDING HEADING, for all three sections of the version panel.
   *
   * It was already one snippet, but each section computed its own pill and the three had drifted
   * into saying different KINDS of thing: Deployment carried a count of Workers without a version
   * and dropped the sync read entirely, so folding it hid whether the two Workers serving the app
   * agree — the one fact a reader opens that section for. Workers carried the same warning with no
   * sense of how many Workers were behind the fold. Database carried a mood ("Needs attention")
   * with no count, so one bad row out of four and four bad rows read identically.
   *
   * All three now hand this the same shape: pills from the model, count first. The heading's own
   * job is only to fold, and to show what folding hides.
   *
   * The pills ride ONLY while it is shut. What the fold hides has to keep speaking; a heading that
   * carries the same pills open and closed is saying it twice, with the rows right underneath.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ChevronRight from "@lucide/svelte/icons/chevron-right";
  import type { SectionPill } from "./version-overlay-model.ts";

  const {
    label,
    collapsed,
    toggle,
    pills = [],
  }: {
    label: string;
    collapsed: boolean;
    toggle: () => void;
    /** What the fold hides, from the model. Count first; a status pill only when there is one. */
    pills?: readonly SectionPill[];
  } = $props();
</script>

<!-- The visible label is the accessible name, and aria-expanded carries the state. -->
<Button
  variant="ghost"
  size="sm"
  class="w-full justify-between gap-8"
  aria-expanded={!collapsed}
  onclick={toggle}
>
  <span class="flex items-center gap-8">
    <FieldLabel as="span">{label}</FieldLabel>
    {#if collapsed}
      {#each pills as pill (pill.label)}
        <Badge variant={pill.variant}>{pill.label}</Badge>
      {/each}
    {/if}
  </span>
  <ChevronRight
    class="size-16 shrink-0 text-text-muted transition-transform duration-fast ease-standard motion-reduce:transition-none {collapsed
      ? ''
      : 'rotate-90'}"
    aria-hidden="true"
  />
</Button>
