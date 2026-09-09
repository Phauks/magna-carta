<script lang="ts">
  /*
   * Textarea — a styled native <textarea> (Tier 1: native element, no Bits UI). The multi-line
   * sibling of Input: same hairline border, focus ring, and disabled treatment, with a multi-line
   * minimum height and vertical-only resize. The commonly-controlled native attributes
   * (`placeholder`, `disabled`) are declared EXPLICITLY (with JSDoc) so docgen lists them under the
   * catalog's "Properties" group with descriptions. `value`/`ref` are bindable; `w-full` is the one
   * layout default.
   *
   * THE GRAB CORNER IS OPTIONAL. A field that stands in a scrolling stack can be pulled taller and
   * the layout absorbs it; one that has already been given the height of the panel it sits in cannot
   * — dragging it there only pushes the form's own footer around, so the field says `resizable`
   * false and the corner goes (owner ruling, 2026-09-08, on the call log's description).
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
      /** Whether the reader may drag the field taller. False where its height is already decided. */
      resizable?: boolean;
    },
    HTMLTextAreaElement
  >;

  let {
    ref = $bindable(null),
    value = $bindable(),
    placeholder,
    disabled,
    resizable = true,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<textarea
  bind:this={ref}
  bind:value
  {placeholder}
  {disabled}
  class={mergeClasses(`mc-textarea${resizable ? "" : " mc-textarea-fixed"} w-full`, className)}
  {...restProps}
></textarea>
