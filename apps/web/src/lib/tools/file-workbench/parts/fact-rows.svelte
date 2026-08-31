<script lang="ts">
  /*
   * The label-and-value list every panel reports its findings in. One shape for all of them, so a
   * reader moving between capabilities is reading the same thing in the same place each time.
   *
   * A value renders through the `value` snippet when it needs marks or emphasis; a plain string
   * value renders as text. Long values (a digest, a media type) wrap rather than truncate: a digest
   * cut short is a digest nobody can check.
   */
  import type { Snippet } from "svelte";
  import type { BadgeVariant } from "@magna-carta/design-system/badge";

  export interface Fact {
    readonly label: string;
    readonly value?: string;
    readonly tone?: BadgeVariant;
    /** Renders in place of `value` where the row needs a badge or a control. */
    readonly render?: Snippet;
    /** Renders under the value at the standard meta offset. */
    readonly note?: string;
    /** Digests, media types, byte sequences: the reading that only works in the mono face. */
    readonly mono?: boolean;
  }

  let { facts }: { facts: readonly Fact[] } = $props();

  // Only the tones that carry a reading get a colour. Everything else is body text: a value tinted
  // for no reason competes with the ones that mean something.
  const TONE_CLASS: Partial<Record<BadgeVariant, string>> = {
    warning: "text-status-warning-subtle-foreground",
    danger: "text-status-danger-subtle-foreground",
    success: "text-status-success-subtle-foreground",
    info: "text-status-info-subtle-foreground",
  };
</script>

<dl class="m-0 flex flex-col gap-8">
  {#each facts as fact (fact.label)}
    <!-- A div per pair, which is the grouping HTML gives a definition list, so the label and its
         value share a row without a two-column grid track sized to arbitrary content. -->
    <div class="flex items-baseline gap-16">
      <dt class="w-96 shrink-0 text-xs text-text-subtle">{fact.label}</dt>
      <dd class="m-0 min-w-0 flex-1 text-sm break-words">
        {#if fact.render}
          {@render fact.render()}
        {:else}
          <span
            class={fact.tone === undefined ? undefined : TONE_CLASS[fact.tone]}
            class:font-mono={fact.mono}
            class:tabular-nums={fact.mono}
          >
            {fact.value}
          </span>
        {/if}
        {#if fact.note}
          <span class="mt-4 block text-xs text-text-muted">{fact.note}</span>
        {/if}
      </dd>
    </div>
  {/each}
</dl>
