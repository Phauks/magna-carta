<script lang="ts">
  /*
   * Notification Center — the shipped stub the top-bar bell opens into. Stage 1 ships the honest
   * empty state; the alerts machinery (mentions, matter updates, deadlines) fills the list when it
   * lands. Nothing here is invented — an empty center is the truth today.
   */
  import EmptyState from "@magna-carta/design-system/empty-state";
  import * as Masthead from "@magna-carta/design-system/masthead";
</script>

<svelte:head>
  <title>Notification Center · Magna Carta</title>
</svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Eyebrow>Notifications</Masthead.Eyebrow>
    <Masthead.Title>Notification Center</Masthead.Title>
    <Masthead.Meta>
      <span>Alerts, mentions, and updates across your matters.</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<EmptyState title="No notifications yet">
  When something needs your attention — a mention, a matter update, an approaching deadline — it
  will gather here. The live feed arrives with the notifications machinery.
</EmptyState>
