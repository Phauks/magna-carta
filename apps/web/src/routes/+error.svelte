<script lang="ts">
  /*
   * The BARE error surface — only for failures outside the (app) shell (in-app errors render inside
   * the chrome via routes/(app)/+error.svelte). Same archetype pattern as every other failure in the
   * product: what happened, the diagnostics a report needs, and the controls that move a person on.
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
</script>

<svelte:head>
  <title>{notFound ? "Not found" : "Something went wrong"} · Magna Carta</title>
</svelte:head>

<div class="flex min-h-screen flex-col items-center justify-center bg-surface-default">
  {#if notFound}
    <EmptyState title="There's nothing at this address">
      The page may have moved, or the link may be stale. Everything in the firm is reachable from
      Home.
      {#snippet actions()}
        <Button variant="primary" href="/home">Go home</Button>
      {/snippet}
    </EmptyState>
  {:else}
    <FailureScreen
      {failure}
      scale="screen"
      subject="This page"
      fallback={page.error?.message}
      steps={[
        "Reload: a brief interruption usually clears on the next attempt.",
        "Go home, and open the screen again from the navigation.",
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
