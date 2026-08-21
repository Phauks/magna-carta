<script lang="ts">
  /*
   * Settings · Billing — a STANDARD settings page: everything (title, posture, plates, rows,
   * draft, history, change requests) derives from the registries through settings-page.svelte.
   * Adding a billing setting is one definitions-registry entry; this file never changes.
   * Preview: these settings persist locally and govern nothing until the authenticated
   * settings API wires in.
   */
  import SettingsPage from "$lib/settings/components/settings-page.svelte";
</script>

<svelte:head>
  <title>Billing · Settings · Magna Carta</title>
</svelte:head>

<SettingsPage
  sectionId="billing"
  meta="Time is billed by these rules across the whole firm."
  preview
/>
