<script lang="ts">
  /*
   * Safe Website Viewer — open an untrusted website at arm's length. The member enters a suspect
   * link in the browser shell's own address bar; the worker opens it in Cloudflare's isolated
   * remote browser and returns a static snapshot. The suspect page never loads in the member's
   * browser, and everything shown here stays inert: the screenshot is a plain image (downloadable
   * and viewable full screen, still just an image), the extracted text renders as escaped
   * preformatted text, and the page's outbound addresses are buttons that re-capture through the
   * same flow, never anchors.
   *
   * THE ISOLATION IS STATED AT THE ADDRESS BAR, not in the masthead. It is the one thing a reader
   * must know before they press, so it belongs beside the control they press rather than in the
   * screen's header, which carries the screen's name and nothing else
   * (docs/conventions/design-corrections.md, "Screen headers"). The band it sits in is the
   * invalid-address band: a fault with the address in hand outranks a standing fact.
   *
   * The viewer is one framed unit rendered from page load, empty and calm — the browser window
   * with its inspector tabs attached — so a capture fills a shape the reader already has. A
   * capture runs staged: the redirect probe settles first and its facts (the landed address, the
   * redirect count) show in the loading viewport while the renderer finishes the full-page shot;
   * the result surfaces (screenshot, tabs) populate only on completion (nothing partial), and a
   * failed capture's alert renders inside the shell's viewport so the frame holds. A capture that
   * landed on a different site reports that on the Overview tab's Different Site row, its one
   * home. Back, forward, and refresh walk a client-side capture history (capture-history.ts):
   * every successful capture pushes an entry stamped with when it completed and how long it took,
   * stepping re-shows the stored view instantly with no re-fetch, and refresh re-captures the
   * current entry's address in place.
   *
   * The inspector's Registration tab reuses the WHOIS page's lookup seam against the landed host,
   * lazily on first activation and cached per host here, so switching tabs never re-queries the
   * registry; a capture landing on a different host drops the cache. The fetch-and-classify
   * branching lives in safe-browse.ts, the derived facts in capture-facts.ts; all three modules
   * stay testable off the DOM. Runs outside any matter and stores nothing.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import WebsiteShell, {
    probeNarrative,
    type ProbeFacts,
  } from "$lib/tools/safe-browse/website-shell.svelte";
  import SnapshotTabs, {
    type RegistrationState,
  } from "$lib/tools/safe-browse/snapshot-tabs.svelte";
  import {
    closeLive,
    normalizeTarget,
    problemGuidance,
    screenshotSource,
    viewLive,
    viewSafelyStaged,
    type SafeBrowseOutcome,
    type SafeWebsiteView,
  } from "$lib/tools/safe-browse/safe-browse.ts";
  import { finalHost, screenshotFilename } from "$lib/tools/safe-browse/capture-facts.ts";
  import { downloadCaptureArchive } from "$lib/tools/safe-browse/capture-export.ts";
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
  import { lookupWhoisWithRetries } from "$lib/tools/whois/whois-lookup.ts";

  type CaptureFailure = Exclude<SafeBrowseOutcome, { kind: "view" }>;

  let query = $state("");
  // Which browser the address bar drives. Static opens each address in a fresh isolated browser;
  // Live keeps one for the member between pages, so a link's cookie-gated steps can be followed.
  let mode = $state<"static" | "live">("static");
  // Live steps taken since the member switched to Live. A new browser on the FIRST step is simply
  // the session starting; a new browser on a later one means the cookies behind them were dropped,
  // which changes how the next page behaves and is worth saying.
  let liveStepsTaken = $state(0);
  let sessionDropped = $state(false);
  let capturing = $state(false);
  // The address the running capture was asked for, shown by the shell's loading viewport.
  let capturingTarget = $state<string | null>(null);
  // The running capture's settled redirect probe: where the link really leads and after how many
  // redirects, known before the renderer finishes. The shell's loading viewport shows these two
  // facts early; the tabs still wait for completion (nothing partial in the result surfaces).
  let probe = $state<ProbeFacts | null>(null);
  let history = $state<CaptureHistory<SafeWebsiteView>>(emptyHistory());
  // The latest capture's failure, if it failed. Cleared by navigating the history (the stored
  // views are still good) and by the next capture starting.
  let failure = $state<CaptureFailure | null>(null);
  // The Registration tab's lookup, cached per landed host so re-opening the tab never re-queries
  // the registry; replaced when the tab activates for a different host, dropped when a capture
  // lands somewhere else.
  let registration = $state<RegistrationState | null>(null);
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

  // What the shell and tabs show: the current history entry, unless the latest capture failed —
  // then the viewport carries the alert and the tabs sit empty, so two captures are never mixed
  // on one screen.
  const currentCapture = $derived(failure === null ? currentEntry(history) : null);
  const displayView = $derived(currentCapture?.view ?? null);
  const downloadFilename = $derived(
    currentCapture !== null && screenshotSource(currentCapture.view.screenshotBase64) !== null
      ? screenshotFilename(currentCapture.view.finalUrl, currentCapture.capturedAt)
      : null,
  );

  async function capture(target: string, historyMode: "push" | "replace") {
    capturing = true;
    capturingTarget = target;
    probe = null;
    failure = null;
    announcement = "";
    const startedAt = Date.now();
    // The staged capture reports the redirect probe as it settles, well before the renderer
    // finishes its full-page shot; the probed fact reaches the loading viewport and the live
    // region while the wait continues.
    // Live has no staged progress to report — the held browser follows the redirects itself and
    // the chain comes back with the page — so the loading viewport shows only the elapsed time.
    const result =
      mode === "live"
        ? await viewLive(target)
        : await viewSafelyStaged(target, (progress) => {
            if (progress.stage === "probed") {
              probe = { redirectCount: progress.redirectCount, finalUrl: progress.finalUrl };
              announcement = probeNarrative(probe);
            }
          });
    if (mode === "live" && result.kind === "view" && "sessionContinued" in result) {
      sessionDropped = liveStepsTaken > 0 && !result.sessionContinued;
      liveStepsTaken += 1;
    }
    const elapsedMs = Date.now() - startedAt;
    capturing = false;
    capturingTarget = null;
    probe = null;
    if (result.kind === "view") {
      const entry = {
        enteredUrl: target,
        view: result.view,
        capturedAt: Date.now(),
        elapsedMs,
        mode,
      };
      history =
        historyMode === "replace" ? replaceCurrent(history, entry) : pushCapture(history, entry);
      announcement = sessionDropped
        ? `Page opened for ${result.view.finalUrl} in a fresh browser. Cookies from earlier pages are gone.`
        : `Snapshot captured for ${result.view.finalUrl}.`;
      // A capture that landed on a different host makes the cached registration someone else's.
      const host = finalHost(result.view.finalUrl);
      if (registration !== null && registration.host !== host) registration = null;
    } else {
      failure = result;
    }
  }

  // Switching away from Live ends the member's session: the held browser is billed for the time
  // it is held, and nobody is walking it any more. Switching TO Live starts nothing until the first
  // navigation — a session opened on a mode switch alone would bill for a browser showing nothing.
  function setMode(next: "static" | "live") {
    if (capturing || next === mode) return;
    if (mode === "live") closeLive();
    mode = next;
    liveStepsTaken = 0;
    sessionDropped = false;
  }

  // Leaving the page while in Live releases the browser too. `pagehide` rather than
  // `beforeunload`, because it fires on mobile and on back-forward cache entry where the other does
  // not; the unmount covers leaving for another screen inside the app.
  $effect(() => {
    const release = () => {
      if (mode === "live") closeLive();
    };
    window.addEventListener("pagehide", release);
    return () => {
      window.removeEventListener("pagehide", release);
      release();
    };
  });

  // Everything on screen for the capture being shown, in one archive. The registration record is
  // included only when it belongs to THIS capture's host — the cache survives stepping back through
  // history, and a registry answer for a different site in the export would be a wrong fact.
  function downloadCapture() {
    const current = currentCapture;
    if (current === null) return;
    const host = finalHost(current.view.finalUrl);
    const outcome = registration?.host === host ? registration.outcome : null;
    const record =
      outcome !== null &&
      (outcome.kind === "rdap" || outcome.kind === "raw" || outcome.kind === "empty")
        ? outcome.result
        : null;
    void downloadCaptureArchive({
      view: current.view,
      capturedAt: current.capturedAt,
      elapsedMs: current.elapsedMs,
      mode: current.mode,
      registration: record,
    });
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

  // The Registration tab asked for the landed host's record. Served from the per-host cache when
  // it already holds this host (looked up, or in flight); otherwise one lookup runs through the
  // WHOIS seam, with its bounded retries reported so the tab can show each attempt.
  function activateRegistration() {
    if (displayView === null) return;
    const host = finalHost(displayView.finalUrl);
    if (host === null) return;
    if (registration !== null && registration.host === host) return;
    void lookupRegistration(host);
  }

  async function lookupRegistration(host: string) {
    registration = { host, loading: true, attempt: null, outcome: null };
    const outcome = await lookupWhoisWithRetries(host, (progress) => {
      if (registration !== null && registration.host === host) {
        registration = { ...registration, attempt: progress };
      }
      if (progress.attempt > 1) {
        announcement = `The registry did not answer. Trying again, attempt ${progress.attempt} of ${progress.maxAttempts}.`;
      }
    });
    // A capture may have moved the viewer to another host while the registry answered; a stale
    // answer is dropped rather than cached under the wrong host.
    if (registration === null || registration.host !== host) return;
    registration = { host, loading: false, attempt: null, outcome };
    if (outcome.kind === "rdap") {
      announcement = `Registration found for ${outcome.result.target}.`;
    } else if (outcome.kind === "raw") {
      announcement = `Unparsed registry text returned for ${outcome.result.target}.`;
    }
  }
</script>

<svelte:head><title>Safe Website Viewer · Magna Carta</title></svelte:head>

<!-- The viewer holds the vertical space it would occupy when full: the page is a full-height
     column and the framed unit takes the remaining height, so the screen does not reflow as a
     capture arrives and leaves no dead band beneath the frame. On narrow screens the halves stack
     and keep their fixed comfortable heights instead — a phone cannot give both full height. The
     Tools layout hands this page the content column bare (its +page.ts claims the scrolling), so
     the page carries the canvas inset itself. -->
<div class="flex h-full flex-col">
  <ScreenHeader title="Safe Website Viewer" class="mb-24" />

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

  <div aria-busy={capturing} class="flex flex-col lg:min-h-0 lg:flex-1">
    <WebsiteShell
      bind:address={query}
      {capturing}
      capturingUrl={capturingTarget}
      {canSubmit}
      invalidHint={invalidInput
        ? "This is not a web address this tool can open. Enter one like https://example.com. Private, local, and internal addresses are not accepted."
        : null}
      note={sessionDropped
        ? "That page opened in a fresh isolated browser, so cookies from earlier pages are gone. It still never loads in your own browser."
        : mode === "live"
          ? "Live keeps one isolated remote browser for you between pages, for up to 15 minutes, so cookies carry over as you follow a link. Only pictures and text come back; nothing loads in your own browser."
          : "The page opens in an isolated remote browser and comes back as a static snapshot. It never loads in your own browser."}
      {mode}
      onmodechange={setMode}
      ondownloadcapture={displayView === null ? undefined : downloadCapture}
      canGoBack={canGoBack(history)}
      canGoForward={canGoForward(history)}
      canRefresh={currentEntry(history) !== null}
      {probe}
      screenshot={displayView === null ? null : screenshotSource(displayView.screenshotBase64)}
      {downloadFilename}
      hasCapture={displayView !== null}
      onsubmit={runCapture}
      onback={goBack}
      onforward={goForward}
      onrefresh={refresh}
      problem={failure === null ? undefined : captureFailure}
    >
      {#snippet inspector()}
        <SnapshotTabs
          view={displayView}
          {capturing}
          capturedAt={currentCapture?.capturedAt ?? null}
          elapsedMs={currentCapture?.elapsedMs ?? null}
          {registration}
          onopenaddress={openAddress}
          onactivateregistration={activateRegistration}
        />
      {/snippet}
    </WebsiteShell>
  </div>
</div>
