<script lang="ts">
  /*
   * The sentence beneath a field that is still holding a record back.
   *
   * It is the design system's own `mc-form-errors` recipe, which is what `LabelledField` and
   * `Form.FieldErrors` already render a refusal in — so a field refused here and a field refused on
   * a validated form read the same, and there is one answer to "what does a refused field look
   * like" rather than a second one invented on the calendar.
   *
   * It renders NOTHING when there is nothing to say, so a caller can place it under every field
   * unconditionally and the form's spacing does not move as answers arrive. That is the standing
   * rule for a control that reports a state: absence is the answer, never an empty box.
   *
   * It is not a component in the design system, because it is three lines over a recipe that is
   * already there and a component would only be a second name for it. If a third surface needs the
   * same thing, that is the moment to move it — not before.
   */
  let { refusal }: { refusal?: string } = $props();
</script>

{#if refusal !== undefined}
  <p class="mc-form-errors">{refusal}</p>
{/if}
