<script lang="ts">
  /*
   * Input — a styled native text-like <input> (Tier 1: native element, no Bits UI).
   *
   * `type` is the closed set of text-like input types only. The special-UI types are deliberately
   * out: `file` is its own styled control (FileInput, a separate component because uploads carry
   * their own UX — drag-and-drop, progress, validation — built out in slice 2·1); checkbox/radio/
   * range/color/the button types render their own widgets the text-field recipe can't dress, so
   * they are not Input's job either.
   *
   * The commonly-controlled native attributes (`placeholder`, `disabled`) are declared EXPLICITLY
   * (with JSDoc) so docgen lists them under the catalog's "Properties" group with descriptions,
   * instead of leaving them in the anonymous attribute spread. `value`/`ref` are bindable; styling
   * is the mc-input recipe; `w-full` is the one layout default (a form control fills its field).
   *
   * `size` is the control-height axis (the Button's scale), which deliberately SHADOWS the native
   * `size` attribute — that attribute sizes a field in characters, a pre-CSS layout mechanism this
   * recipe set has no use for, and leaving both spellings live would make `size="4"` mean two
   * different things. Field width is a utility (`w-full` by default), never a character count.
   */
  import type { HTMLInputAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { InputType } from "./types.ts";
  import { inputClasses, type InputSize } from "./variants.ts";

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "size" | "type"> & {
      /** Input type — one of the text-like types (file/checkbox/radio/range/color and the button types are not Input's job). */
      type?: InputType;
      /** Control height, from the same scale the Button uses. */
      size?: InputSize;
      /** Hint text shown while the field is empty (not an accessible label). */
      placeholder?: string;
      /** Disables the field so it cannot be focused or edited; renders muted. */
      disabled?: boolean;
    },
    HTMLInputElement
  >;

  let {
    ref = $bindable(null),
    value = $bindable(),
    size = "default",
    placeholder,
    disabled,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<input
  bind:this={ref}
  bind:value
  {placeholder}
  {disabled}
  class={mergeClasses(`${inputClasses({ size })} w-full`, className)}
  {...restProps}
/>
