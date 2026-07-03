<script lang="ts">
  /*
   * FileInput — a styled native <input type="file"> (Tier 1: native element, no Bits UI). The
   * file-picking sibling of Input: same hairline border, focus ring, and disabled treatment, with
   * its `::file-selector-button` dressed to the secondary-button look so the whole control reads as
   * part of the system rather than the raw browser default.
   *
   * This is the bare control only. The full upload experience — drag-and-drop zone, selected-file
   * list, progress, validation, and the R2 wiring — is a larger surface that builds on top of this
   * primitive in slice 2·1.
   *
   * A file control's value is read-only (set by the user, never the page), and `input.files` is not
   * generically assignable, so this does NOT two-way bind it: read the selection from the element
   * `ref` (`ref.files`) or a forwarded `onchange` (`event.currentTarget.files`). `accept` and
   * `multiple` are declared EXPLICITLY (with JSDoc) so docgen lists them under the catalog's
   * "Properties" group; `ref` is bindable; `w-full` is the one layout default (a control fills its field).
   */
  import type { HTMLInputAttributes } from "svelte/elements";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "type" | "value"> & {
      /** Filter offered in the picker (the native `accept` attribute), e.g. `image/*,.pdf`. */
      accept?: string;
      /** Allow selecting more than one file. */
      multiple?: boolean;
      /** Disables the control so it cannot be focused or opened; renders muted. */
      disabled?: boolean;
    },
    HTMLInputElement
  >;

  let {
    ref = $bindable(null),
    accept,
    multiple,
    disabled,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<input
  bind:this={ref}
  type="file"
  {accept}
  {multiple}
  {disabled}
  class={mergeClasses("mc-file-input w-full", className)}
  {...restProps}
/>
