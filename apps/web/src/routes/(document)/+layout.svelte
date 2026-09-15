<script lang="ts">
  /*
   * The (document) route group — a single document, open in its own tab.
   *
   * SAME SHELL, WITHOUT THE RAIL. This is the App Shell the rest of the signed-in application
   * renders in, asked for without its destination rail. The top bar stays, because everything on it
   * is about the SESSION rather than about where you are: the search, the transfer trays, the
   * notifications, the profile. The rail is the part that is about where you are, and this tab is
   * not anywhere — it is one document, for as long as it is open. A column of somewhere-else beside
   * it only offers to navigate away from the single thing the tab exists for, and the way back that
   * does make sense (to the matter this document belongs to) is already in the document's own
   * header, named after that matter.
   *
   * The session guard is the (app) group's guard, shared rather than copied
   * ($lib/navigation/session-guard.ts) — a document tab is a signed-in surface like any other, and
   * deep-linking to one without a session must land on /login exactly as anywhere else does.
   */
  import AppShell from "$lib/components/app-shell.svelte";
  import PlatformNotice from "$lib/diagnostics/platform-notice.svelte";

  let { children } = $props();
</script>

<AppShell navigation={false}>
  <PlatformNotice />
  {@render children()}
</AppShell>
