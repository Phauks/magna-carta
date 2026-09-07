<script lang="ts">
  /*
   * The root layout with one page beneath it and no route group in between — the shape of the
   * sign-in screen, which mounts outside (app) and so gets nothing from the app shell.
   */
  import type { Component } from "svelte";
  import Layout from "../src/routes/+layout.svelte";

  let { Page }: { Page: Component } = $props();
</script>

<Layout>
  <Page />
</Layout>
