<script lang="ts">
  /*
   * The ingest-outcome chip — one home for how a file's status reads, so the four views cannot
   * describe the same file three different ways. A clean file renders nothing: the ordinary case
   * wears no chip, which leaves the two that need attention as the only marked rows.
   *
   * A rejected file names its reason where the server gave one. That is the whole point of showing
   * quarantined rows at all — a file the scanner flagged must say so where the member dropped it.
   */
  import Badge from "@magna-carta/design-system/badge";
  import type { FileSummary } from "@magna-carta/api-client";
  import { fileStatusPresentation } from "./file-presentation.ts";

  let { file }: { file: FileSummary } = $props();

  const presentation = $derived(fileStatusPresentation(file));
</script>

{#if presentation !== null}
  <!-- The reason is server text of unbounded length, and the narrow views (a tile, a gallery cell)
       are the ones that have to hold it. The row WRAPS rather than compressing: beside the chip in a
       table cell there is room to read it, but in a 160px cell the chip and the reason cannot share a
       line without shredding the text into one word per row — so the reason drops to its own line and
       takes the full width. `break-words` is the backstop for a single unbroken token. -->
  <span class="inline-flex min-w-0 flex-wrap items-center gap-8">
    <Badge variant={presentation.variant}>{presentation.label}</Badge>
    {#if presentation.detail !== null}
      <span class="min-w-0 break-words text-xs text-text-muted">{presentation.detail}</span>
    {/if}
  </span>
{/if}
