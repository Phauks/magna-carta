<script lang="ts">
  /*
   * The (app) route group — every signed-in surface renders inside the App Shell. The session guard
   * lives in the co-located +layout.ts load: an unauthenticated visitor (a 401 from the bootstrap
   * endpoint) is redirected to /login; a transport failure (no Worker behind a frontend-only dev
   * server) lets the shell render anyway.
   */
  import AppShell from "$lib/components/app-shell.svelte";

  let { children } = $props();
</script>

<AppShell>
  {@render children()}
</AppShell>
