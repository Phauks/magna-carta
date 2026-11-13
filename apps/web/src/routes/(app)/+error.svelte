<script lang="ts">
  /*
   * The in-shell error surface: a wrong turn inside the app keeps the chrome (sidebar + top bar stay
   * usable — an error must never strand the user; owner review 2026-07-02). The bare root
   * +error.svelte remains for failures outside the shell.
   *
   * A 404 is not a failure and does not pretend to be one: nothing broke, there is nothing to
   * report, and no Error ID exists to quote — so it keeps the empty state it always had.
   */
  import { page } from "$app/state";
  import Button from "@magna-carta/design-system/button";
  import EmptyState from "@magna-carta/design-system/empty-state";
  import FailureScreen from "$lib/diagnostics/failure-screen.svelte";
  import ReportDialog from "$lib/diagnostics/report-dialog.svelte";
  import { routeFailure } from "$lib/diagnostics/route-failure.ts";

  const notFound = $derived(page.status === 404);
  const failure = $derived(routeFailure(page));
  let reportOpen = $state(false);

  // Back renders only when there is somewhere to go back TO: a direct or external landing has no
  // in-app history, and hiding Back beats offering a dead button (the no-dead-controls rule).
  // history.length is a coarse signal but the honest one available.
  const canGoBack = typeof history !== "undefined" && history.length > 1;
</script>

<svelte:head>
  <title>{notFound ? "Not found" : "Something went wrong"} · Magna Carta</title>
</svelte:head>

<div class="flex flex-col items-center">
  {#if notFound}
    <EmptyState title="There's nothing at this address">
      The page may have moved or the link may be out of date. Use the menu on the left to find what you need.
      {#snippet actions()}
        <!-- Back first — the fastest recovery from a wrong turn is the page you just left. -->
        {#if canGoBack}
          <Button variant="primary" onclick={() => history.back()}>Go Back</Button>
        {/if}
        <Button variant={canGoBack ? "secondary" : "primary"} href="/home">Go home</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <FailureScreen
      {failure}
      scale="screen"
      subject="This screen"
      fallback={page.error?.message}
      reassurance="Your saved work isn't affected. Only this screen failed to load."
      steps={[
        "Reload: a brief interruption usually clears on the next attempt.",
        "Open the screen again from the navigation on the left.",
        "If it keeps happening, report it with the Error ID above.",
      ]}
      onRetry={() => location.reload()}
      onReport={() => (reportOpen = true)}
    />
    <ReportDialog
      bind:open={reportOpen}
      errorId={failure.problem?.errorId ?? null}
      route={failure.request}
    />
  {/if}
</div>
