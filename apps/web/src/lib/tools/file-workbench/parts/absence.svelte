<script lang="ts">
  /*
   * A capability with nothing to show, saying which kind of nothing it is.
   *
   * Three silences mean three different things, and a blank panel says none of them: a capability
   * that has not been asked to run, one that has nothing to do on this file, and one that broke.
   * Each gets its own mark and its own line, so a reader is never left deciding whether the screen
   * is empty or wrong.
   */
  import type { Snippet } from "svelte";
  import CircleDashed from "@lucide/svelte/icons/circle-dashed";
  import CircleSlash from "@lucide/svelte/icons/circle-slash";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { mergeClasses } from "@magna-carta/design-system/internal/merge-classes";

  let {
    kind,
    reason,
    actions,
  }: {
    kind: "not-run" | "not-applicable" | "failed";
    /** One line, plain language, saying why there is nothing here. */
    reason: string;
    /** Where the way out of this state belongs, when there is one. */
    actions?: Snippet;
  } = $props();

  const HEADINGS = {
    "not-run": "Not Run",
    "not-applicable": "Does Not Apply",
    failed: "Could Not Finish",
  } as const;

  const MARKS = {
    "not-run": CircleDashed,
    "not-applicable": CircleSlash,
    failed: TriangleAlert,
  } as const;

  const Mark = $derived(MARKS[kind]);
</script>

<div class="flex flex-col items-start gap-8 py-16">
  <FieldLabel
    as="span"
    class={mergeClasses("flex items-center gap-8", kind === "failed" && "text-status-danger")}
  >
    <Mark class="size-16" aria-hidden="true" />
    {HEADINGS[kind]}
  </FieldLabel>
  <p class="max-w-prose text-sm text-text-muted">{reason}</p>
  {#if actions}
    <div class="flex flex-wrap gap-8">{@render actions()}</div>
  {/if}
</div>
