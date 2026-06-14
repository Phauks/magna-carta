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
   */
  import type { HTMLInputAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { InputType } from "./types.ts";

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "type"> & {
      /** Input type — one of the text-like types (file/checkbox/radio/range/color and the button types are not Input's job). */
      type?: InputType;
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
  class={mergeClasses("mc-input w-full", className)}
  {...restProps}
/>
