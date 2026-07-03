<script lang="ts">
  /*
   * The in-shell error surface: a wrong turn inside the app keeps the chrome (sidebar + top bar
   * stay usable — an error must never strand the user; owner review 2026-07-02). The bare root
   * +error.svelte remains for failures outside the shell.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";

  const notFound = $derived(page.status === 404);
</script>

<svelte:head>
  <title>{notFound ? "Not found" : "Something went wrong"} · Magna Carta</title>
</svelte:head>

{#if notFound}
  <EmptyState title="There's nothing at this address">
    The page may have moved, or the link may be stale — the navigation on the left has everything
    that exists today.
    {#snippet actions()}
      <Button variant="primary" href="/home">Go home</Button>
    {/snippet}
  </EmptyState>
{:else}
  <EmptyState title="Something went wrong">
    The error has been noted{page.error?.message ? ` — ${page.error.message}` : ""}. Retry, and if
    it persists, report the problem with the Error ID shown here.
    {#snippet actions()}
      <Button variant="primary" onclick={() => location.reload()}>Retry</Button>
      <Button variant="secondary" href="/home">Go home</Button>
    {/snippet}
  </EmptyState>
{/if}
