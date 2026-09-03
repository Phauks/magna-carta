<script lang="ts">
  import FieldLabel from "@magna-carta/design-system/field-label";
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
  <FieldLabel as="h2" class="border-b border-border-strong pb-8"
  >
    {section.label}
  </FieldLabel>
  <p class="max-w-xl text-sm text-text-muted">{section.description}</p>
  <FieldLabel as="p"
  >
    Arriving soon
  </FieldLabel>
</section>
