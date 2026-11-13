<script lang="ts">
  /*
   * A signer's page that failed while it loaded, rather than while it rendered.
   *
   * The nearest error page to a signer's link, so SvelteKit draws this instead of the root one, which
   * prints the address in its trace; on this page the address is the link.
   */
  import { page } from "$app/state";
  import AuthPanel from "$lib/auth/auth-panel.svelte";
</script>

<svelte:head>
  <title>Something Went Wrong</title>
</svelte:head>

<div class="flex h-dvh items-center justify-center bg-surface-sunken p-24">
  <AuthPanel title="This Page Could Not Be Opened">
    <p class="text-sm">
      Reload the page to try again. If it still does not open, reply to the email the link came in.
      {#if page.error?.errorId}Error ID {page.error.errorId}.{/if}
    </p>
  </AuthPanel>
</div>
