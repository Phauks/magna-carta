<script lang="ts">
  /*
   * A settings page's descriptor — what this page governs, said once, at the top of the page's
   * own content.
   *
   * IT IS PAGE CONTENT, NOT CHROME. It used to sit inside the masthead band, which made settings
   * the one archetype whose header carried a sentence: every other screen's header is the screen's
   * name and nothing else (docs/conventions/design-corrections.md, "Screen headers"). The
   * information was worth keeping — a setting's name is terse and its reach is not obvious — so it
   * moved rather than being deleted, and it now scrolls with the plates it describes instead of
   * being pinned above them (owner's ruling, 2026-09-06).
   *
   * It leads the scroll area, so it takes the sunken register a lead line takes and never a
   * heading's: the plates below carry the headings, and a second bold line above them would
   * compete with the page title for the same job.
   */
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<p class="max-w-3xl text-sm text-text-muted">{@render children()}</p>
