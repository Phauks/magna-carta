<script lang="ts">
  /*
   * The in-shell error surface: a wrong turn inside the app keeps the chrome (sidebar + top bar
   * stay usable — an error must never strand the user; owner review 2026-07-02). The bare root
   * +error.svelte remains for failures outside the shell.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import ErrorDetails from "$lib/components/error-details.svelte";

  const notFound = $derived(page.status === 404);

  // Back renders only when there is somewhere to go back TO: a direct or external landing has
  // no in-app history, and hiding Back beats offering a dead button (the no-dead-controls
  // rule). history.length is a coarse signal but the honest one available.
  const canGoBack = typeof history !== "undefined" && history.length > 1;
</script>

<svelte:head>
  <title>{notFound ? "Not found" : "Something went wrong"} · Magna Carta</title>
</svelte:head>

<div class="flex flex-col items-center">
  {#if notFound}
    <EmptyState title="There's nothing at this address">
      The page may have moved, or the link may be stale — the navigation on the left has
      everything that exists today.
      {#snippet actions()}
        <!-- Back first — the fastest recovery from a wrong turn is the page you just left. -->
        {#if canGoBack}
          <Button variant="primary" onclick={() => history.back()}>Go Back</Button>
        {/if}
        <Button variant={canGoBack ? "secondary" : "primary"} href="/home">Go home</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <EmptyState title="Something went wrong">
      The error has been noted. Retry, and if it persists, copy the details below into a report.
      {#snippet actions()}
        <Button variant="primary" onclick={() => location.reload()}>Retry</Button>
        <Button variant="secondary" href="/home">Go home</Button>
      {/snippet}
    </EmptyState>
  {/if}
  <ErrorDetails />
</div>
