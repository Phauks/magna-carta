<script lang="ts">
  /*
   * A guest's page that failed while it loaded, rather than while it rendered.
   *
   * The nearest error page to a guest's link, so SvelteKit draws this instead of the root one — which
   * prints the address in its trace and offers Home, and on this page the address is the link.
   * Whatever the failure, a guest is told the same thing the render boundary tells them.
   */
  import { page } from "$app/state";
  import GuestFailure from "$lib/meetings/guest-failure.svelte";
</script>

<svelte:head>
  <title>Something Went Wrong</title>
</svelte:head>

<GuestFailure errorId={page.error?.errorId ?? null} />
