<script lang="ts">
  /*
   * Settings · Firm Profile — a STANDARD settings page: everything (title, posture, plates,
   * rows, draft, history, change requests) derives from the registries through
   * settings-page.svelte. Adding a firm-profile setting is one definitions-registry entry;
   * this file never changes. Preview: these settings persist locally and govern nothing until
   * the authenticated settings API wires in.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
</script>

<svelte:head>
  <title>Firm Profile · Settings · Magna Carta</title>
</svelte:head>

<SettingsPage
  sectionId="firm-profile"
  meta="Identity facts about the firm that flow into invoices, the portal, and generated documents."
  preview
/>
