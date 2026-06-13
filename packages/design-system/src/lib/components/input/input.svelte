<script lang="ts">
  /*
   * Input — a styled native text-like <input> (Tier 1: native element, no Bits UI).
   *
   * File uploads are a SEPARATE concern with their own UX (drag-and-drop, progress, validation) and
   * land as a dedicated component in slice 2·1 — so `type="file"` is excluded from this component's
   * type rather than mixed in here.
   *
   * The commonly-controlled native attributes (`placeholder`, `disabled`) are declared EXPLICITLY
   * (with JSDoc) so docgen lists them under the catalog's "Properties" group with descriptions,
   * instead of leaving them in the anonymous attribute spread. `value`/`ref` are bindable; styling
   * is the mc-input recipe; `w-full` is the one layout default (a form control fills its field).
   */
  import type { HTMLInputAttributes, HTMLInputTypeAttribute } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "type"> & {
      /** Input type — any text-like type (file uploads are a separate component, so `file` is excluded). */
      type?: Exclude<HTMLInputTypeAttribute, "file">;
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
