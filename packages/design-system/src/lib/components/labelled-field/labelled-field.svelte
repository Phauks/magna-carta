<script lang="ts">
  /*
   * LabelledField — a label, the control it names, and the line or two beneath it, stacked the one
   * way every plain form in the product stacks them.
   *
   * Measured before it was built: the fifteen panels on the action dialog shell wrote this wrapper
   * by hand fifty-six times — the same column, the same gap, a hand-minted id on each side of the
   * label — and hints under the control were described to a screen reader in some and not others.
   * A layout every form rebuilds is a layout that drifts one form at a time.
   *
   * It is deliberately NOT the form family's Field. That one is bound to formsnap and superforms
   * and exists for a schema-validated form; this one is for the fields a panel keeps in its own
   * state and validates as a refusal on the commit. The two stack the same parts, and they differ
   * in one measure: this one uses the panels' own gap (space-8, as every migrated panel had it),
   * the form family's uses space-4. That difference is recorded on the recipe rather than smoothed
   * over here, because it is the owner's to settle.
   *
   * The control is a snippet handed `props` and spreads them — the same idiom formsnap's Control
   * uses — so the association cannot be mis-wired: the id is minted here unless the caller needs
   * to name it, the hint and the error are joined into one `aria-describedby`, and an error marks
   * the control `aria-invalid`.
   */
  import type { Snippet } from "svelte";
  import Label from "../label/index.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { LabelledFieldControlProperties } from "./types.ts";

  let {
    id: givenIdentifier,
    label,
    hint,
    error,
    class: className,
    children,
  }: {
    /** The label's text — the field's name in the reader's words, never a placeholder's. */
    label: string;
    /** The line beneath the control that helps before anything goes wrong. */
    hint?: string;
    /** What is wrong with the value, if anything. Also marks the control invalid. */
    error?: string;
    /** The control's id. Minted when omitted; give one only to point something else at it. */
    id?: string;
    class?: string;
    /** The control, handed the attributes that tie it to the label, the hint and the error. */
    children: Snippet<[{ props: LabelledFieldControlProperties }]>;
  } = $props();

  const minted = $props.id();
  const identifier = $derived(givenIdentifier ?? minted);
  const hintIdentifier = $derived(`${identifier}-hint`);
  const errorIdentifier = $derived(`${identifier}-error`);

  const describedBy = $derived.by((): string | undefined => {
    const parts = [
      hint === undefined ? null : hintIdentifier,
      error === undefined ? null : errorIdentifier,
    ].filter((part): part is string => part !== null);
    return parts.length === 0 ? undefined : parts.join(" ");
  });

  const controlProperties = $derived<LabelledFieldControlProperties>({
    id: identifier,
    "aria-describedby": describedBy,
    "aria-invalid": error === undefined ? undefined : true,
    title: error,
  });
</script>

<div class={mergeClasses("mc-labelled-field", className)}>
  <Label for={identifier}>{label}</Label>
  {@render children({ props: controlProperties })}
  {#if hint !== undefined}
    <p id={hintIdentifier} class="mc-form-description">{hint}</p>
  {/if}
  {#if error !== undefined}
    <!-- Read, never shown (owner ruling 2026-11-13): "if there are ever errors in a field, no
         text, but you can highlight them in red". A line of text appearing under one field of a
         row pushed that field down and the row out of line. The control turns red through
         aria-invalid (input.css, combobox.css), carries the message as its hover title, and a
         screen reader still hears it through aria-describedby. -->
    <p id={errorIdentifier} class="sr-only">{error}</p>
  {/if}
</div>
