<script lang="ts">
  /*
   * VerificationCodeInput (Tier 2) — the segmented one-time-code control, over Bits UI PinInput.
   * Self-contained like Checkbox: the wrapper renders the cells itself, so a consumer binds a value
   * and picks a length.
   *
   * Bits renders ONE hidden input stretched across the cells (the cells are presentational boxes),
   * which is why every code-entry behaviour comes for free and is consistent: typing advances the
   * active cell, Backspace steps back, arrow keys and Home/End move the caret, and a pasted code
   * fills every cell at once. That single input is also what makes browser and platform autofill
   * work — it carries `autocomplete="one-time-code"` (Bits' default, overridable through the
   * attribute spread), where a six-input implementation would offer autofill six disjoint targets.
   *
   * `value`, `ref` (the cell row) and `inputRef` (that hidden input — bind it to call `focus()`) are
   * bindable, `onComplete` fires once the last cell is filled, and every other input attribute
   * (`aria-label`, `aria-invalid`, `aria-describedby`, `name`, `autocomplete`, …) forwards to the
   * hidden input, so the control labels and validates like a single field.
   */
  import { PinInput } from "bits-ui";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithoutChildrenOrChild } from "../../internal/types.ts";

  type Props = WithoutChildrenOrChild<Omit<PinInput.RootProps, "maxlength">> & {
    /** How many cells the code has. */
    length?: number;
    /** Disables the control so it cannot be focused or typed into; renders muted. */
    disabled?: boolean;
  };

  let {
    ref = $bindable(null),
    inputRef = $bindable(null),
    value = $bindable(""),
    length = 6,
    disabled = false,
    class: className,
    ...restProps
  }: Props = $props();
</script>

<PinInput.Root
  bind:ref
  bind:inputRef
  bind:value
  maxlength={length}
  {disabled}
  class={mergeClasses("mc-verification-code-input", className)}
  {...restProps}
>
  {#snippet children({ cells })}
    {#each cells as cell, index (index)}
      <PinInput.Cell {cell} class="mc-verification-code-input-cell">{cell.char}</PinInput.Cell>
    {/each}
  {/snippet}
</PinInput.Root>
