<script lang="ts">
  /*
   * The account page header — the page's TITLE and nothing else.
   *
   * It began as a lean cousin of the settings masthead: title plus a one-line descriptor, minus
   * that masthead's posture badge, documentation seam and history ledger, which speak a settings
   * vocabulary a credential surface does not have. The descriptor has now gone the same way
   * (owner correction, 2026-09-18). Every line it carried restated its own heading — "Profile:
   * your identity within Magna Carta", "Active Sessions: the devices signed in to your account" —
   * and a surface whose every heading is followed by a sentence explaining the heading reads as a
   * manual rather than as the member's own record. The rail already says where somebody is; the
   * title says what they are looking at; anything a member must be TOLD belongs beside the control
   * it applies to, not under the page name.
   *
   * Pinned by structure, not sticky: the account content column is a flex stack (header /
   * scrolling middle), so this band sits above the scroll area and carries the column's own
   * top/inline padding, letting the scroll area beneath reach the true canvas edges.
   */
  import ScreenHeader from "$lib/screen/screen-header.svelte";

  let { title }: { title: string } = $props();
</script>

<div class="border-b border-border-strong px-24 pt-24 pb-12">
  <ScreenHeader {title} />
</div>
