<script lang="ts">
  /*
   * PasswordInput (Tier 1: native <input>, no Bits UI) — the styled password field with an in-field
   * Show/Hide toggle. It composes the Input component rather than restyling one, so the field keeps
   * the single text-field recipe (border, focus edge, disabled treatment) and only the affordance is
   * new: the toggle flips the input's `type` between "password" and "text".
   *
   * The toggle is its own small recipe rather than a ghost Button because it is an IN-FIELD
   * affordance — it has to fill the field's block extent, sit flush at the inline end, and carry no
   * control height of its own; the Button recipe's min-block-size and padding fight all three.
   *
   * Accessibility: the toggle is a real <button type="button"> (never submits the form it sits in),
   * carries `aria-pressed` for the revealed state, and its accessible name changes with that state
   * ("Show password" / "Hide password") so a screen reader announces what pressing it will do. The
   * Lucide glyph is decorative. The revealed value is never logged or emitted anywhere — the
   * component only ever reads it through the two-way binding the consumer owns.
   *
   * `value` and `ref` (the underlying <input>) are bindable; every other input attribute
   * (`id`, `name`, `autocomplete`, `required`, `aria-invalid`, `aria-describedby`, …) forwards to
   * the field through the attribute spread.
   */
  import type { HTMLInputAttributes } from "svelte/elements";
  import Eye from "@lucide/svelte/icons/eye";
  import EyeOff from "@lucide/svelte/icons/eye-off";
  import Input from "../input/input.svelte";
  import type { InputSize } from "../input/variants.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";

  type Props = WithElementRef<
    Omit<HTMLInputAttributes, "size" | "type"> & {
      /** Control height, from the same scale the Button and Input use. */
      size?: InputSize;
      /** Hint text shown while the field is empty (not an accessible label). */
      placeholder?: string;
      /** Disables the field and its Show/Hide toggle; renders muted. */
      disabled?: boolean;
      /** Accessible name of the toggle while the value is hidden. */
      showLabel?: string;
      /** Accessible name of the toggle while the value is revealed. */
      hideLabel?: string;
    },
    HTMLInputElement
  >;

  let {
    ref = $bindable(null),
    value = $bindable(""),
    size = "default",
    disabled,
    showLabel = "Show password",
    hideLabel = "Hide password",
    class: className,
    ...restProps
  }: Props = $props();

  let revealed = $state(false);
  const ToggleIcon = $derived(revealed ? EyeOff : Eye);
</script>

<div class={mergeClasses("mc-password-input w-full", className)}>
  <Input
    bind:ref
    bind:value
    type={revealed ? "text" : "password"}
    {size}
    {disabled}
    class="mc-password-input-field"
    {...restProps}
  />
  <button
    type="button"
    class="mc-password-input-toggle"
    aria-pressed={revealed}
    aria-label={revealed ? hideLabel : showLabel}
    {disabled}
    onclick={() => (revealed = !revealed)}
  >
    <ToggleIcon class="mc-password-input-toggle-icon" aria-hidden="true" />
  </button>
</div>
