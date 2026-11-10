<script lang="ts">
  /*
   * Slider (Tier 2) — one value along a track, over Bits UI Slider (role="slider", arrow keys, Home
   * and End, pointer drag). Self-contained: the caller writes one <Slider> and never composes the
   * track, the fill or the thumb, which is what keeps every slider in the product one shape.
   *
   * `label` names the thumb, because the thumb is the control a screen reader lands on; `valueText`
   * is what it reads back when the number alone would mislead (a seek bar is "12 minutes 41 seconds",
   * not "761"). `buffered` draws a second, quieter fill behind the value: how far a stream has
   * loaded, as a fraction of the track. `onValueCommit` fires once when a drag or a key press ends,
   * where `value` follows every move.
   */
  import { Slider as SliderPrimitive } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";

  let {
    value = $bindable(0),
    min = 0,
    max = 100,
    step = 1,
    label,
    valueText,
    buffered,
    disabled = false,
    onValueChange,
    onValueCommit,
    class: className,
  }: {
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    /** The accessible name of the thumb. */
    label: string;
    /** What a screen reader announces for the value, where the number alone would mislead. */
    valueText?: string;
    /** How much of the track has loaded, from 0 to 1. Omit where nothing loads. */
    buffered?: number;
    disabled?: boolean;
    onValueChange?: (value: number) => void;
    onValueCommit?: (value: number) => void;
    class?: string;
  } = $props();

  const bufferedPercent = $derived(
    buffered === undefined ? null : Math.min(100, Math.max(0, buffered * 100)),
  );
</script>

<SliderPrimitive.Root
  type="single"
  bind:value
  {min}
  {max}
  {step}
  {disabled}
  {onValueChange}
  {onValueCommit}
  class={mergeClasses("mc-slider w-full min-w-0 flex-1", className)}
>
  {#snippet children({ thumbItems })}
    <span class="mc-slider-track">
      {#if bufferedPercent !== null}
        <span class="mc-slider-buffered" style="inline-size: {bufferedPercent}%"></span>
      {/if}
      <SliderPrimitive.Range class="mc-slider-range" />
    </span>
    {#each thumbItems as thumb (thumb.index)}
      <SliderPrimitive.Thumb
        index={thumb.index}
        class="mc-slider-thumb"
        aria-label={label}
        aria-valuetext={valueText}
      />
    {/each}
  {/snippet}
</SliderPrimitive.Root>
