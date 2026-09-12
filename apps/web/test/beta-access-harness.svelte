<script lang="ts">
  /*
   * The Beta Access page beneath the one thing the root layout gives every page and a bare mount
   * does not: the tooltip provider the settings masthead's controls read their delays from.
   */
  import * as Tooltip from "@magna-carta/design-system/tooltip";
  import BetaAccessPage from "../src/routes/(app)/settings/beta-access/+page.svelte";
</script>

<Tooltip.Provider>
  <BetaAccessPage />
</Tooltip.Provider>
