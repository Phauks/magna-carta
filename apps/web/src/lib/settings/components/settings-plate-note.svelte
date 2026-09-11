<script lang="ts">
  /*
   * A line that closes a plate — one fact the rows above it need stated once, in the plate's own
   * rhythm: the muted register, and the row padding, so it sits between the plate's rules like a
   * row rather than as a paragraph poured under the table.
   *
   * It is the ONLY prose a plate carries, and it exists for a consequence, not an explanation
   * (docs/conventions/design-corrections.md, "No info lines"): what a change reaches, what a
   * retired word keeps, why a value is shown rather than offered. A sentence that merely restates
   * what the rows already say is removed, not moved here.
   */
  import type { Snippet } from "svelte";

  let { children }: { children: Snippet } = $props();
</script>

<p class="py-8 text-sm text-text-muted">{@render children()}</p>
