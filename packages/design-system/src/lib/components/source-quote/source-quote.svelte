<script lang="ts">
  /*
   * SourceQuote — a passage quoted from a source, as a card the claim it supports sits above.
   *
   * The shape is the owner's chosen citation card: a coloured tab naming what kind of source this is
   * and its number in the answer's source list, a header with the source's name and where in it the
   * passage is (with the caller's acts, such as Open and Copy Citation, beside it), the quote itself
   * in the display serif inside quotation marks, and a footer strip saying what check the quote
   * passed and where and when it was read.
   *
   * THE QUOTE IS PLAIN TEXT. It is rendered as children, never as markup: a quote comes from a model
   * or from a document a third party wrote, and an HTML path through this component would be the one
   * place that stopped being untrusted text. The quotation marks are drawn by the component, so a
   * caller passes the passage alone.
   *
   * Every word is the caller's: the kind's label, the title, the location, the check and the
   * provenance all arrive as props, so the component holds no copy of its own.
   */
  import type { Snippet } from "svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import Landmark from "@lucide/svelte/icons/landmark";
  import Gavel from "@lucide/svelte/icons/gavel";
  import FileText from "@lucide/svelte/icons/file-text";
  import Check from "@lucide/svelte/icons/check";
  import { mergeClasses } from "../../internal/merge-classes.ts";
  import type { WithElementRef } from "../../internal/types.ts";
  import type { SourceQuoteCheckTone, SourceQuoteKind } from "./types.ts";

  let {
    ref = $bindable(null),
    kind,
    kindLabel,
    number,
    title,
    location,
    check,
    checkTone = "verified",
    provenance,
    actions,
    class: className,
    children,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLElement>, HTMLElement> & {
    /** What kind of source the passage comes from; decides the hue and the tab's icon. */
    kind: SourceQuoteKind;
    /** The tab's words for the kind, such as "Statute", "Case" or "Matter File". */
    kindLabel: string;
    /** The source's number in the answer's numbered source list, drawn as "[n]" on the tab. */
    number?: number;
    /** The source's name: a statute's section, a case's name, a file's name. */
    title: string;
    /** Where in the source the passage is: the subdivision, the reporter and pin cite, the page and clause. */
    location?: string;
    /** What check the quote passed, such as "Verified Quote". Left out, the footer carries provenance alone. */
    check?: string;
    /** Whether that check passed. */
    checkTone?: SourceQuoteCheckTone;
    /** Where and when the passage was read: the provider or matter, and the time. */
    provenance?: string;
    /** The acts on the source, such as Open and Copy Citation, set beside the title. */
    actions?: Snippet;
  } = $props();

  const KindIcon = $derived(kind === "statute" ? Landmark : kind === "case" ? Gavel : FileText);
</script>

<figure
  bind:this={ref}
  data-kind={kind}
  class={mergeClasses("mc-source-quote", className)}
  {...restProps}
>
  <figcaption class="mc-source-quote-tab">
    <KindIcon class="size-12" aria-hidden="true" />
    <span>{kindLabel}</span>
    {#if number !== undefined}<span class="mc-source-quote-number">[{number}]</span>{/if}
  </figcaption>
  <div class="mc-source-quote-card">
    <div class="mc-source-quote-head">
      <div class="mc-source-quote-identity">
        <p class="mc-source-quote-title">{title}</p>
        {#if location !== undefined}<p class="mc-source-quote-location">{location}</p>{/if}
      </div>
      {#if actions !== undefined}
        <div class="mc-source-quote-actions">{@render actions()}</div>
      {/if}
    </div>
    <blockquote class="mc-source-quote-text">“{@render children?.()}”</blockquote>
    {#if check !== undefined || provenance !== undefined}
      <div class="mc-source-quote-foot">
        {#if check !== undefined}
          <span class="mc-source-quote-check" data-tone={checkTone}>
            {#if checkTone === "verified"}<Check class="size-12" aria-hidden="true" />{/if}
            {check}
          </span>
        {/if}
        {#if provenance !== undefined}<span>{provenance}</span>{/if}
      </div>
    {/if}
  </div>
</figure>
