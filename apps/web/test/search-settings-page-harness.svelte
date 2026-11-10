<script lang="ts">
  /*
   * The Search and Indexing settings page beneath the one thing the root layout gives every page
   * and a bare mount does not: the tooltip provider the settings masthead's controls read their
   * delays from.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import SearchSettingsPage from "../src/routes/(app)/settings/search-and-indexing/+page.svelte";
</script>

<Tooltip.Provider>
  <SearchSettingsPage />
</Tooltip.Provider>
