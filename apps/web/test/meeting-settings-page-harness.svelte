<script lang="ts">
  /*
   * The Meetings settings page beneath the one thing the root layout gives every page and a bare
   * mount does not: the tooltip provider the settings masthead's controls read their delays from.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import MeetingSettingsPage from "../src/routes/(app)/settings/meetings/+page.svelte";
</script>

<Tooltip.Provider>
  <MeetingSettingsPage />
</Tooltip.Provider>
