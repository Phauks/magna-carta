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
  import {
    DRAFT_NUMBER_DESCRIPTION,
    renderReference,
    SUBJECT_SEPARATOR,
  } from "./record-reference-model.ts";
  import type { RecordSubject } from "./types.ts";

  let { subject }: { subject: RecordSubject } = $props();

  const reference = $derived(subject.reference ? renderReference(subject.reference) : null);
  const facts = $derived(subject.facts ?? []);
  const trailing = $derived([...facts]);
  /* A reference with no words in it — a draft whose number is still being held, with no kind —
     renders nothing, so no separator is drawn in front of the first fact. */
  const referenceShown = $derived(
    reference !== null &&
      (reference.kind !== "" || reference.shape === "identified"),
  );
</script>

{#snippet separator()}
  <span class="mc-record-subject-separator" aria-hidden="true">{SUBJECT_SEPARATOR}</span>
{/snippet}

<span class="mc-record-subject">
  {#if reference !== null}
    {#if reference.shape === "identified"}
      <span class="mc-record-subject-reference">
        {#if reference.kind !== ""}{reference.kind}{/if}
        {#if reference.draft}
          <!-- The product's one mark for a number a record does not carry yet: italics, with the
               reason on the number for a pointer. -->
          <em
            class="mc-record-subject-number mc-record-subject-draft"
            title={DRAFT_NUMBER_DESCRIPTION}>{reference.number}</em
          >
        {:else}
          <span class="mc-record-subject-number">{reference.number}</span>
        {/if}
      </span>
    {:else if reference.kind !== ""}
      <span class="mc-record-subject-reference">{reference.kind}</span>
    {/if}
  {/if}
  {#each trailing as fact, index (index)}
    {#if index > 0 || referenceShown}{@render separator()}{/if}
    <span>{fact}</span>
  {/each}
</span>
