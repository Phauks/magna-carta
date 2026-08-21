<script lang="ts">
  /*
   * A settings PLATE — one category group of rows in the engraved-table voice. Structure comes
   * from rules, not boxes: the small-caps group header seats directly on a full-width ink-tinted
   * hairline (a ledger column heading), the rows follow, and a closing rule of the same weight
   * ends the plate. Open left and right, no card fill, no shadow — text on the canvas would read
   * as floating; framed in a card it would read as a widget; ruled top and bottom it reads as a
   * ledger. Between rows the dividers step down to the quieter border ink so the framing rules
   * keep the authority.
   */
  import type { Snippet } from "svelte";

  let { heading, children }: { heading: string; children: Snippet } = $props();
</script>

<section class="flex flex-col">
  <h3
    class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    {heading}
  </h3>
  <div class="flex flex-col divide-y divide-border-default border-b border-border-strong">
    {@render children()}
  </div>
</section>
