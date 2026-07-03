<script lang="ts">
  /* Form.Label — formsnap's Label (auto-associated with the field control via `for`/`id`) dressed with
     the shared mc-label recipe. Used inside Form.Control. */
  import { Label as FormsnapLabel } from "formsnap";
  import type { ComponentProps } from "svelte";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let { class: className, ...restProps }: ComponentProps<typeof FormsnapLabel> = $props();
</script>

<FormsnapLabel class={mergeClasses("mc-label", className)} {...restProps} />
