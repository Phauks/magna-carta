<script lang="ts">
  /*
   * MergeFieldReviewList — the surface where placeholders detected in an uploaded document are
   * presented for a person to confirm, one row at a time.
   *
   * The posture is the component's whole reason to exist, so it is structural rather than a matter
   * of wording: every row is a PROPOSAL with a checkbox, the standing guidance says plainly that
   * nothing has changed, and the row shape (types.ts) has no state that could render as "already
   * converted". A surface that implies data conversion must ask, not report.
   *
   * Composed from what the package already has — Checkbox for the confirmation, MergeFieldChip for
   * the proposed field, Badge for the confidence (golden rule 1). It is CONTROLLED: rows carry
   * `confirmed` and the consumer records the change from `onToggle`, so the list never holds an
   * opinion the caller has not seen.
   */
  import ArrowRight from "@lucide/svelte/icons/arrow-right";
  import Badge from "../badge/index.ts";
  import Checkbox from "../checkbox/index.ts";
  import MergeFieldChip from "../merge-field-chip/merge-field-chip.svelte";
  import type { BadgeVariant } from "../badge/variants.ts";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { MergeFieldReviewConfidence, MergeFieldReviewItem } from "./types.ts";

  let {
    items,
    heading = "Placeholders found in this document",
    headingLevel = 3,
    guidance = "These are suggestions read from the document you uploaded. Nothing has been changed — confirm each one you want to use.",
    emptyMessage = "No placeholders needing review were found in this document.",
    onToggle,
    class: className,
    ...restProps
  }: {
    /** The proposals, in the order they should be reviewed (document order reads best). */
    items: readonly MergeFieldReviewItem[];
    /** The section heading. */
    heading?: string;
    /** Which heading element to render, so the surrounding page keeps a legal heading order. */
    headingLevel?: 2 | 3 | 4 | 5;
    /** The standing guidance line. Reword it, but do not let it imply the change already happened. */
    guidance?: string;
    /** Shown instead of the list when there is nothing to review. */
    emptyMessage?: string;
    /** Fires when a person confirms or un-confirms a row. The consumer records it. */
    onToggle?: (id: string, confirmed: boolean) => void;
    class?: string;
    [attribute: string]: unknown;
  } = $props();

  const scope = $props.id();
  const headingId = `${scope}-heading`;

  const CONFIDENCE_LABELS: Record<MergeFieldReviewConfidence, string> = {
    exact: "Exact match",
    likely: "Likely match",
    uncertain: "Uncertain",
  };
  const CONFIDENCE_VARIANTS: Record<MergeFieldReviewConfidence, BadgeVariant> = {
    exact: "success",
    likely: "info",
    uncertain: "warning",
  };

  /**
   * The checkbox's accessible name. It states the action and its subject in one phrase, because a
   * checkbox named only "Confirm" tells a screen-reader user nothing about which row they are on.
   */
  function confirmLabel(item: MergeFieldReviewItem): string {
    return item.proposedLabel === null
      ? `Confirm that ${item.sourceText} needs a field chosen for it`
      : `Use ${item.proposedLabel} for ${item.sourceText}`;
  }
</script>

<section
  aria-labelledby={headingId}
  class={mergeClasses("mc-merge-field-review-list", className)}
  {...restProps}
>
  <svelte:element this={`h${headingLevel}`} id={headingId} class="mc-merge-field-review-heading">
    {heading}
  </svelte:element>
  <p class="mc-merge-field-review-guidance">{guidance}</p>

  {#if items.length === 0}
    <p class="mc-merge-field-review-empty">{emptyMessage}</p>
  {:else}
    <ul class="mc-merge-field-review-rows">
      {#each items as item (item.id)}
        <li class="mc-merge-field-review-row">
          <Checkbox
            checked={item.confirmed}
            onCheckedChange={(checked) => onToggle?.(item.id, checked === true)}
            aria-label={confirmLabel(item)}
            class="mc-merge-field-review-checkbox"
          />
          <div class="mc-merge-field-review-body">
            <div class="mc-merge-field-review-proposal">
              <code class="mc-merge-field-review-source">{item.sourceText}</code>
              <ArrowRight class="mc-merge-field-review-arrow" aria-hidden="true" />
              {#if item.proposedLabel === null}
                <MergeFieldChip label="No suggestion" status="unavailable" />
              {:else}
                <MergeFieldChip
                  label={item.proposedLabel}
                  valueTypeLabel={item.proposedValueTypeLabel}
                  status="automatic"
                />
              {/if}
              <Badge variant={CONFIDENCE_VARIANTS[item.confidence]}>
                {CONFIDENCE_LABELS[item.confidence]}
              </Badge>
            </div>
            <p class="mc-merge-field-review-note">{item.note}</p>
            {#if item.sourceLocation}
              <p class="mc-merge-field-review-location">{item.sourceLocation}</p>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
