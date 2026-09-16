<script lang="ts">
  /*
   * RecordSubject — the subtitle line of a modal, rendered in one place.
   *
   * WHAT IT IS FOR. The line under a panel's heading answers one question — what is being acted on —
   * and the record's own number is its whole answer. Before this component the answer was an
   * interpolated string per call site, and thirty of them disagreed: a middle dot in five places and
   * an em dash in a sixth for the same join, `tabular-nums` written by hand or not at all, and the
   * words for a number that does not exist yet living in exactly one file while the other panels that
   * needed them showed nothing.
   *
   * IT NAMES NO RECORD KIND, which is the same promise the shells above it make. The kind is a
   * caller's own word; the design system decides how a reference reads and never what one is.
   *
   * THE SEPARATORS ARE HIDDEN FROM THE ACCESSIBILITY TREE. A middle dot read aloud between every
   * fact is noise in the one line a reader is listening for the number in. Sighted readers get the
   * mark, screen readers get the facts.
   */
  import { renderReference, SUBJECT_SEPARATOR } from "./record-reference-model.ts";
  import type { RecordSubject } from "./types.ts";

  let { subject }: { subject: RecordSubject } = $props();

  const reference = $derived(subject.reference ? renderReference(subject.reference) : null);
  const facts = $derived(subject.facts ?? []);
  /* The preview's own words ride the fact run, so the separator between them is the shared one. */
  const trailing = $derived(
    reference !== null && reference.shape === "identified" && reference.note !== null
      ? [reference.note, ...facts]
      : [...facts],
  );
</script>

{#snippet separator()}
  <span class="mc-record-subject-separator" aria-hidden="true">{SUBJECT_SEPARATOR}</span>
{/snippet}

<span class="mc-record-subject">
  {#if reference !== null}
    {#if reference.shape === "identified"}
      <span class="mc-record-subject-reference">
        {reference.kind}
        <span class="mc-record-subject-number">{reference.number}</span>
      </span>
    {:else if reference.shape === "awaiting"}
      <span class="mc-record-subject-reference">{reference.sentence}</span>
    {:else}
      <span class="mc-record-subject-reference">{reference.kind}</span>
    {/if}
  {/if}
  {#each trailing as fact, index (index)}
    {#if index > 0 || reference !== null}{@render separator()}{/if}
    <span>{fact}</span>
  {/each}
</span>
