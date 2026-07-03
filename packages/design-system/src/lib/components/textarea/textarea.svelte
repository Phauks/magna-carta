<script lang="ts">
  /*
   * Textarea — a styled native <textarea> (Tier 1: native element, no Bits UI). The multi-line
   * sibling of Input: same hairline border, focus ring, and disabled treatment, with a multi-line
   * minimum height and vertical-only resize. The commonly-controlled native attributes
   * (`placeholder`, `disabled`) are declared EXPLICITLY (with JSDoc) so docgen lists them under the
   * catalog's "Properties" group with descriptions. `value`/`ref` are bindable; `w-full` is the one
   * layout default.
   */
  import type { HTMLTextareaAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  type Props = WithElementRef<
    HTMLTextareaAttributes & {
      /** Hint text shown while the field is empty (not an accessible label). */
      placeholder?: string;
      /** Disables the field so it cannot be focused or edited; renders muted. */
      disabled?: boolean;
    },
    HTMLTextAreaElement
  >;

  let {
    ref = $bindable(null),
    value = $bindable(),
    placeholder,
    disabled,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<textarea
  bind:this={ref}
  bind:value
  {placeholder}
  {disabled}
  class={mergeClasses("mc-textarea w-full", className)}
  {...restProps}
></textarea>
