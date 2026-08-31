<script lang="ts">
  /*
   * Safe Website Viewer — open an untrusted website at arm's length. The member enters a suspect
   * link in the browser shell's own address bar; the worker opens it in Cloudflare's isolated
   * remote browser and returns a static snapshot. The suspect page never loads in the member's
   * browser, and everything shown here stays inert: the screenshot is a plain image, the extracted
   * text renders as escaped preformatted text, and the page's outbound addresses are buttons that
   * re-capture through the same flow, never anchors.
   *
   * The two-column region — the shell on the left, the information tabs on the right — renders
   * from page load, empty and calm, so a capture fills a shape the reader already has. The shell
   * populates only completed captures (nothing partial), and a failed capture's alert renders
   * inside the shell's viewport so the frame holds. Back, forward, and refresh walk a client-side
   * capture history (capture-history.ts): every successful capture pushes an entry, stepping
   * re-shows the stored view instantly with no re-fetch, and refresh re-captures the current
   * entry's address in place. The fetch-and-classify branching lives in safe-browse.ts; both
   * modules stay testable off the DOM. Runs outside any matter and stores nothing.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import WebsiteShell from "$lib/tools/safe-browse/website-shell.svelte";
  import SnapshotTabs from "$lib/tools/safe-browse/snapshot-tabs.svelte";
  import {
    landedOnDifferentHost,
    normalizeTarget,
    problemGuidance,
    screenshotSource,
    viewSafely,
    type SafeBrowseOutcome,
    type SafeWebsiteView,
  } from "$lib/tools/safe-browse/safe-browse.ts";
  import {
    back,
    canGoBack,
    canGoForward,
    currentEntry,
    emptyHistory,
    forward,
    pushCapture,
    replaceCurrent,
    type CaptureHistory,
  } from "$lib/tools/safe-browse/capture-history.ts";

  type CaptureFailure = Exclude<SafeBrowseOutcome, { kind: "view" }>;

  let query = $state("");
  let capturing = $state(false);
  let history = $state<CaptureHistory<SafeWebsiteView>>(emptyHistory());
  // The latest capture's failure, if it failed. Cleared by navigating the history (the stored
  // views are still good) and by the next capture starting.
  let failure = $state<CaptureFailure | null>(null);
  // A short summary announced to assistive technology when the snapshot arrives. Problem and
  // transport states render as an Alert, which announces itself via its role, so they are left out
  // of this region to avoid a double reading.
  let announcement = $state("");

  // The entry control validates before it enables: an input that cannot be a web address disables
  // the Load Website button and the inline hint under the shell's top bar says what is wrong, so a
  // predictable input fault is prevented at the field rather than delivered as an error.
  const normalized = $derived(normalizeTarget(query));
  const invalidInput = $derived(query.trim() !== "" && normalized === null);
  const canSubmit = $derived(!capturing && normalized !== null);

  // What the shell and tabs show: the current history entry's view, unless the latest capture
  // failed — then the viewport carries the alert and the tabs sit empty, so two captures are
  // never mixed on one screen.
  const displayView = $derived(failure === null ? (currentEntry(history)?.view ?? null) : null);
  const landedUrl = $derived(
    !capturing && displayView !== null && landedOnDifferentHost(displayView)
      ? displayView.finalUrl
      : null,
  );

  async function capture(target: string, mode: "push" | "replace") {
    capturing = true;
    failure = null;
    announcement = "";
    const result = await viewSafely(target);
    capturing = false;
    if (result.kind === "view") {
      const entry = { enteredUrl: target, view: result.view };
      history = mode === "replace" ? replaceCurrent(history, entry) : pushCapture(history, entry);
      announcement = `Snapshot captured for ${result.view.finalUrl}.`;
    } else {
      failure = result;
    }
  }

  function runCapture() {
    if (!canSubmit || normalized === null) return;
    void capture(normalized, "push");
  }

  // An outbound address (or redirect hop) opened from the tabs: the address bar takes it and a
  // fresh capture of it goes onto the history, exactly as if the member had entered it.
  function openAddress(url: string) {
    if (capturing) return;
    query = url;
    const target = normalizeTarget(url);
    if (target === null) return;
    void capture(target, "push");
  }

  function goBack() {
    if (capturing || !canGoBack(history)) return;
    history = back(history);
    failure = null;
    query = currentEntry(history)?.enteredUrl ?? query;
  }

  function goForward() {
    if (capturing || !canGoForward(history)) return;
    history = forward(history);
    failure = null;
    query = currentEntry(history)?.enteredUrl ?? query;
  }

  function refresh() {
    const current = currentEntry(history);
    if (capturing || current === null) return;
    query = current.enteredUrl;
    void capture(current.enteredUrl, "replace");
  }
</script>

<svelte:head><title>Safe Website Viewer · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Safe Website Viewer</Masthead.Title>
    <Masthead.Meta>
      <span>The page renders in an isolated remote browser</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<!-- Polite live region: announces an arrived snapshot to a screen reader without re-reading the
     whole result. Alert-rendered states announce themselves through their own role. -->
<div aria-live="polite" class="sr-only">{announcement}</div>

{#snippet captureFailure()}
  {#if failure !== null}
    {#if failure.kind === "problem"}
      {@const guidance = problemGuidance(failure.problem)}
      <Alert.Root variant={guidance.tone}>
        <Alert.Title>{guidance.title}</Alert.Title>
        <Alert.Description>
          {guidance.message}
          {#if guidance.tone === "danger" && failure.problem.errorId}
            <span class="mt-8 block">
              Error ID: <span class="font-mono">{failure.problem.errorId}</span>
            </span>
          {/if}
        </Alert.Description>
      </Alert.Root>
    {:else}
      <Alert.Root variant="danger">
        <Alert.Title>The capture service did not respond</Alert.Title>
        <Alert.Description>
          Nothing answered the request. Check your connection, then try again.
        </Alert.Description>
      </Alert.Root>
    {/if}
  {/if}
{/snippet}

<div class="flex flex-col gap-16 lg:flex-row" aria-busy={capturing}>
  <div class="min-w-0 lg:w-3/5">
    <WebsiteShell
      bind:address={query}
      {capturing}
      {canSubmit}
      invalidHint={invalidInput
        ? "This is not a web address this tool can open. Enter one like https://example.com. Private, local, and internal addresses are not accepted."
        : null}
      canGoBack={canGoBack(history)}
      canGoForward={canGoForward(history)}
      canRefresh={currentEntry(history) !== null}
      {landedUrl}
      screenshot={displayView === null ? null : screenshotSource(displayView.screenshotBase64)}
      hasCapture={displayView !== null}
      onsubmit={runCapture}
      onback={goBack}
      onforward={goForward}
      onrefresh={refresh}
      problem={failure === null ? undefined : captureFailure}
    />
  </div>
  <div class="min-w-0 lg:w-2/5">
    <SnapshotTabs view={displayView} {capturing} onopenaddress={openAddress} />
  </div>
</div>
