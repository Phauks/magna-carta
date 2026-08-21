<script lang="ts">
  /*
   * The Sitemap module — the live app's real page routes as a tree that mirrors the URL hierarchy
   * (sitemap.ts, generated from the route files). Staged display pages live in the Fixtures module.
   */
  import SitemapTree from "../../sitemap-tree.svelte";
  import { SITEMAP_TREE } from "../../sitemap.ts";
</script>

<SitemapTree nodes={SITEMAP_TREE} />
