<script lang="ts">
  /*
   * Textarea — a styled native <textarea> (Tier 1: native element, no Bits UI). The multi-line
   * sibling of Input: same hairline border, focus ring, and disabled treatment, plus a sensible
   * minimum height and `resize: vertical` (horizontal resize would break a form's column width).
   * `value`/`ref` are bindable; styling is the mc-textarea recipe; `w-full` is the one layout
   * default (a form control fills its field), overridable via `class`.
   */
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  let {
    ref = $bindable(null),
    value = $bindable(),
    class: className,
    ...restProps
  }: WithElementRef<HTMLTextareaAttributes, HTMLTextAreaElement> = $props();
</script>

<textarea
  bind:this={ref}
  bind:value
  class={mergeClasses("mc-textarea w-full", className)}
  {...restProps}
></textarea>
