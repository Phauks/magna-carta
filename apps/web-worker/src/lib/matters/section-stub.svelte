<script lang="ts">
  /*
   * The honest stub for a matter section whose real surface has not shipped yet: the section's
   * name as a quiet ledger heading, one paragraph saying what will live here, and a small-caps
   * note that it is coming. No fake chrome and no ghost tables — a stub states the shape of
   * what arrives, it never imitates it.
   */
  import type { MatterSection } from "./sections.ts";

  let { section }: { section: MatterSection } = $props();
</script>

<section class="flex flex-col gap-16">
  <h2
    class="border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    {section.label}
  </h2>
  <p class="max-w-xl text-sm text-text-muted">{section.description}</p>
  <p
    class="text-xs text-text-subtle uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Arriving soon
  </p>
</section>
