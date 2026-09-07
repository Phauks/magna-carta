<script lang="ts">
  /*
   * Notifications — the shipped stub the top-bar bell opens into. Stage 1 ships the honest empty
   * state; the alerts machinery (mentions, matter updates, deadlines) fills the list when it
   * lands. Nothing here is invented — an empty screen is the truth today.
   */
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
</script>

<svelte:head>
  <title>Notifications · Magna Carta</title>
</svelte:head>

<ScreenHeader title="Notifications" class="mb-24" />

<EmptyState title="No notifications yet">
  When something needs your attention — a mention, a matter update, an approaching deadline — it
  will gather here. The live feed arrives with the notifications machinery.
</EmptyState>
