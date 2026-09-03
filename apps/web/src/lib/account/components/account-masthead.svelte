<script lang="ts">
  /*
   * The account page header — INFORMATION ONLY, mirroring the settings masthead's top story but
   * lean: title + one-line descriptor, nothing else. It deliberately omits the settings
   * masthead's posture badge, documentation seam, and history ledger — those speak a settings
   * vocabulary ("Applies on save", a section's registry) that a credential surface does not
   * have. Same design-system Masthead primitives, so the visual voice is identical.
   *
   * Pinned by structure, not sticky: the account content column is a flex stack (header /
   * scrolling middle), so this band sits above the scroll area and carries the column's own
   * top/inline padding, letting the scroll area beneath reach the true canvas edges.
   */
  import * as Masthead from "@magna-carta/design-system/masthead";
  import ScreenHeader from "$lib/screen/screen-header.svelte";

  let { title, meta }: { title: string; meta: string } = $props();
</script>

<div class="border-b border-border-strong px-24 pt-24 pb-12">
  <ScreenHeader {title} />
  <Masthead.Meta class="mt-4">
    <span>{meta}</span>
  </Masthead.Meta>
</div>
