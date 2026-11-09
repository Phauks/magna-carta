<script lang="ts">
  /*
   * The (app) route group — every signed-in surface renders inside the App Shell. The session guard
   * lives in the co-located +layout.ts load: an unauthenticated visitor (a 401 from the bootstrap
   * endpoint) is redirected to /login; a transport failure (no Worker behind a frontend-only dev
   * server) lets the shell render anyway.
   *
   * The platform notice sits above every screen because it is the one thing no screen can say for
   * itself: a panel knows its own read failed, and only the shell can see that several did.
   *
   * ONE SCREEN DECLINES THE SHELL. A page whose load answers `shell: "none"` renders alone in the
   * viewport: no rail, no top bar, no notice — today that is the document editor, which the owner
   * wants to be the whole screen while a document is open. The posture is read off the page's own
   * data rather than a flag on the shell so the shell keeps a single shape and the decision stays
   * with the address that made it; the session guard still runs, because the group's load runs
   * before any page's.
   *
   * THE SHELL READS THE MEMBER'S PERMISSIONS ONCE. The rail and the palette gate rows on them
   * (`$lib/tools/tool-permissions.ts`), and neither may wait for some screen to happen to ask first;
   * the read is shared and single-flight, so a screen that asks again is answered from it.
   */
  import { page } from "$app/state";
  import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
  import AppShell from "$lib/components/app-shell.svelte";
  import PlatformNotice from "$lib/diagnostics/platform-notice.svelte";

  let { children } = $props();

  $effect(() => {
    void sessionPermissions.load(fetch);
  });

  const shellless = $derived((page.data as { shell?: string }).shell === "none");
</script>

{#if shellless}
  <div class="flex h-screen flex-col overflow-hidden bg-surface-default">
    {@render children()}
  </div>
{:else}
  <AppShell>
    <PlatformNotice />
    {@render children()}
  </AppShell>
{/if}
