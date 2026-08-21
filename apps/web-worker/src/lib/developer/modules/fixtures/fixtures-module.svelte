<script lang="ts">
  /*
   * The Fixtures module — staged display pages that showcase a design with plausible data
   * (dev-fixtures.ts), grouped by kind. Distinct from the Sitemap, which lists the live app's
   * real routes.
   */
  import DevPageLinks from "../../dev-page-links.svelte";
  import { FIXTURE_GROUPS } from "../../dev-fixtures.ts";
</script>

<DevPageLinks groups={FIXTURE_GROUPS} />
