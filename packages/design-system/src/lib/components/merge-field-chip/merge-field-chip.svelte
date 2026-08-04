<script lang="ts">
  /*
   * MergeFieldChip — the token that stands in for an inserted merge field (Tier 1: native <span>,
   * no Bits UI). It reads a field's HUMAN LABEL, not its key path: a template's placeholders are
   * chosen from a catalog, so nobody should have to decode `matter.responsibleAttorney` on sight.
   *
   * Three things ride on the chip, in this order of importance:
   *   1. the label — what the field is;
   *   2. the status — whether the reader has to do anything about it (see variants.ts);
   *   3. the value type — which kind of value lands here, so a date chip is not mistaken for text.
   *
   * The status is never colour-only: each status carries a Lucide glyph AND screen-reader text.
   *
   * A span, not a button — a chip labels. Passing `onRemove` adds a real nested <button> for the
   * one interaction a chip legitimately owns; anything else belongs on a control around it.
   */
  import type { HTMLAttributes } from "svelte/elements";
  import CircleCheck from "@lucide/svelte/icons/circle-check";
  import CircleSlash from "@lucide/svelte/icons/circle-slash";
  import PencilLine from "@lucide/svelte/icons/pencil-line";
  import TriangleAlert from "@lucide/svelte/icons/triangle-alert";
  import X from "@lucide/svelte/icons/x";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import {
    mergeFieldChipClasses,
    MERGE_FIELD_CHIP_STATUS_TEXT,
    type MergeFieldChipStatus,
  } from "./variants.ts";

  let {
    label,
    valueTypeLabel,
    status = "automatic",
    onRemove,
    removeLabel,
    ref = $bindable(null),
    class: className,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> & {
    /** The field's human label — what a person calls it, never the key path. */
    label: string;
    /** Short name of the value type ("Date", "Money"); omitted when the context already says. */
    valueTypeLabel?: string;
    /** Whether the reader has to do anything about this field. */
    status?: MergeFieldChipStatus;
    /** Supply to render the remove button. Omitted, the chip is purely a label. */
    onRemove?: () => void;
    /** Accessible name for the remove button; defaults to "Remove <label>". */
    removeLabel?: string;
  } = $props();

  const STATUS_ICONS = {
    automatic: CircleCheck,
    manual: PencilLine,
    unavailable: CircleSlash,
    invalid: TriangleAlert,
  };

  const StatusIcon = $derived(STATUS_ICONS[status]);
</script>

<span
  bind:this={ref}
  class={mergeClasses(mergeFieldChipClasses({ status }), "max-w-full", className)}
  {...restProps}
>
  <StatusIcon class="mc-merge-field-chip-icon" aria-hidden="true" />
  <span class="mc-merge-field-chip-label">{label}</span>
  {#if valueTypeLabel}
    <span class="mc-merge-field-chip-type">{valueTypeLabel}</span>
  {/if}
  <span class="sr-only">{MERGE_FIELD_CHIP_STATUS_TEXT[status]}</span>
  {#if onRemove}
    <button
      type="button"
      class="mc-merge-field-chip-remove"
      aria-label={removeLabel ?? `Remove ${label}`}
      onclick={onRemove}
    >
      <X class="mc-merge-field-chip-remove-icon" aria-hidden="true" />
    </button>
  {/if}
</span>
