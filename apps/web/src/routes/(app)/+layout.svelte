<script lang="ts">
  /*
   * The (app) route group — every signed-in surface renders inside the App Shell. The session guard
   * lives in the co-located +layout.ts load: an unauthenticated visitor (a 401 from the bootstrap
   * endpoint) is redirected to /login; a transport failure (no Worker behind a frontend-only dev
   * server) lets the shell render anyway.
   *
   * The platform notice sits above every screen because it is the one thing no screen can say for
   * itself: a panel knows its own read failed, and only the shell can see that several did.
   */
  import AppShell from "$lib/components/app-shell.svelte";
  import PlatformNotice from "$lib/diagnostics/platform-notice.svelte";

  let { children } = $props();
</script>

<AppShell>
  <PlatformNotice />
  {@render children()}
</AppShell>
