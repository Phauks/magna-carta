<script lang="ts">
  /*
   * The boundary around every route: a throw while a component renders becomes the failure screen
   * with a client-minted Error ID, instead of a blank page and a line in a console nobody opens.
   *
   * SVELTEKIT DOES NOT CATCH THIS. `+error.svelte` answers a failure inside `load`; a throw during
   * rendering — a component reading a context nobody provided, a null the template did not expect —
   * escapes the app's start as an unhandled rejection. The global handlers in hooks.client.ts see
   * it pass and leave a breadcrumb, but they cannot replace the screen, because they do not know
   * what was rendering. This does: it wraps the rendering, so it knows exactly which subtree failed
   * and puts the standard failure screen in its place. It sits in the root layout, above every
   * route group, for the same reason the Tooltip.Provider does — the signed-out screens crash too,
   * and were the first to (the sign-in screen, on a tooltip with no provider above it, 2026-09).
   *
   * THE SCREEN IS THE ROOT +error.svelte's, through the same components, so the two cannot drift:
   * the same heading, the same four facts, the same copyable trace, the same Reload and Report
   * controls. Reload rather than the boundary's own reset: a render throw is deterministic, and
   * re-rendering the same subtree would fail again and mint a second handle for one fault.
   *
   * What the screen says about the cause is CRASH_MESSAGE and nothing more (crash.ts says why).
   */
  import type { Snippet } from "svelte";
  import { page } from "$app/state";
  import FailureScreen from "./failure-screen.svelte";
  import ReportDialog from "./report-dialog.svelte";
  import { CRASH_MESSAGE, crashSignature, noteCrash, PAGE_CRASH_STEPS } from "./crash.ts";
  import { recordCrash } from "./crash-record.ts";
  import { routeFailure } from "./route-failure.ts";

  let { children }: { children: Snippet } = $props();

  let errorId = $state<string | null>(null);
  /** What was thrown and where, shown beside the Error ID (crash.ts says what it may carry). */
  let cause = $state<string | null>(null);
  let reportOpen = $state(false);

  // The record the root +error.svelte builds from `page`, with the status SvelteKit itself gives a
  // failure it could not attribute to a request.
  const failure = $derived(
    routeFailure({
      status: 500,
      error:
        errorId === null
          ? null
          : { message: CRASH_MESSAGE, errorId, ...(cause === null ? {} : { cause }) },
      url: page.url,
    }),
  );
</script>

<svelte:head>
  <!-- The tab says what the screen says; a head tag cannot live inside the snippet, so it keys off
       the same state. -->
  {#if errorId !== null}
    <title>Something went wrong · Magna Carta</title>
  {/if}
</svelte:head>

<svelte:boundary
  onerror={(error) => {
    errorId = noteCrash(error, page.url.pathname);
    recordCrash(errorId, error, page.route.id ?? page.url.pathname);
    cause = crashSignature(error);
  }}
>
  {@render children()}

  {#snippet failed()}
    <div class="flex min-h-screen flex-col items-center justify-center bg-surface-default">
      <FailureScreen
        {failure}
        scale="screen"
        subject="This page"
        fallback={CRASH_MESSAGE}
        steps={PAGE_CRASH_STEPS}
        onRetry={() => location.reload()}
        onReport={() => (reportOpen = true)}
      />
      <ReportDialog
        bind:open={reportOpen}
        errorId={failure.problem?.errorId ?? null}
        route={failure.request}
      />
    </div>
  {/snippet}
</svelte:boundary>
