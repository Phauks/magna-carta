<script lang="ts">
  /*
   * Safe Website Viewer — open an untrusted website at arm's length. The member pastes a suspect
   * link; the worker opens it in Cloudflare's isolated remote browser and returns a static
   * snapshot. The suspect page never loads in the member's browser, and everything shown here
   * stays inert: the screenshot is a plain image, the extracted text renders as escaped
   * preformatted text, and the page's outbound links render as text only, never as anchors. The
   * fetch and the branching that decides which state to show live in safe-browse.ts so they stay
   * testable off the DOM.
   *
   * The query form is the run control and sits at the content's reading edge below the masthead;
   * the screen carries no explanatory prose (owner-directed) — controls, labels, and results only.
   * The result is two columns: the website shell on the left, which renders its frame the moment a
   * capture starts and populates the screenshot only when the capture has completed (nothing
   * partial ever appears — the safety point of the shell), and the information tabs on the right.
   * A capture that came back without a screenshot says so inside the same frame, a link that
   * landed on a different site than it started on is called out in the shell's top bar, and a
   * failure surfaces its correlated Error ID. Runs outside any matter and stores nothing.
   */
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import WebsiteShell from "$lib/tools/safe-browse/website-shell.svelte";
  import SnapshotTabs from "$lib/tools/safe-browse/snapshot-tabs.svelte";
  import {
    landedOnDifferentHost,
    normalizeTarget,
    problemGuidance,
    screenshotSource,
    viewSafely,
    type SafeBrowseOutcome,
  } from "$lib/tools/safe-browse/safe-browse.ts";

  let query = $state("");
  let phase = $state<"idle" | "loading" | "done">("idle");
  let outcome = $state<SafeBrowseOutcome | null>(null);
  // A short summary announced to assistive technology when the snapshot arrives. Problem and
  // transport states render as an Alert, which announces itself via its role, so they are left out
  // of this region to avoid a double reading.
  let announcement = $state("");

  const loading = $derived(phase === "loading");
  // The control validates before it enables: an input that cannot be a web address disables the
  // button and the inline hint below the form says what is wrong, so a predictable input fault is
  // prevented at the field rather than delivered as an error after a press.
  const normalized = $derived(normalizeTarget(query));
  const invalidInput = $derived(query.trim() !== "" && normalized === null);
  const canSubmit = $derived(!loading && normalized !== null);

  async function runCapture(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit || normalized === null) return;
    const target = normalized;
    phase = "loading";
    outcome = null;
    announcement = "";
    const result = await viewSafely(target);
    outcome = result;
    phase = "done";
    if (result.kind === "view") {
      announcement = `Snapshot captured for ${result.view.finalUrl}.`;
    }
  }
</script>

<svelte:head><title>Safe Website Viewer · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Safe Website Viewer</Masthead.Title>
    <Masthead.Meta>
      <span>The page renders in an isolated remote browser, never in yours</span>
    </Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<form onsubmit={runCapture} class="mb-16 flex items-center gap-8">
  <Label for="safe-website-viewer-url" class="sr-only">Web address to view</Label>
  <Input
    id="safe-website-viewer-url"
    name="url"
    class="w-sm"
    bind:value={query}
    placeholder="https://example.com"
    autocomplete="off"
    autocapitalize="none"
    spellcheck={false}
    disabled={loading}
  />
  <Button type="submit" variant="primary" disabled={!canSubmit}>
    {loading ? "Capturing…" : "View Safely"}
  </Button>
</form>

{#if invalidInput}
  <p class="mb-16 text-xs text-text-muted">
    This is not a web address this tool can open. Enter one like https://example.com. Private,
    local, and internal addresses are not accepted.
  </p>
{/if}

<!-- Polite live region: announces an arrived snapshot to a screen reader without re-reading the
     whole result. Alert-rendered states announce themselves through their own role. -->
<div aria-live="polite" class="sr-only">{announcement}</div>

{#if phase !== "idle"}
  <section aria-busy={loading}>
    <h2
      class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      Result
    </h2>

    {#if loading || (outcome !== null && outcome.kind === "view")}
      {@const view = outcome !== null && outcome.kind === "view" ? outcome.view : null}
      <div class="flex flex-col gap-16 lg:flex-row">
        <div class="min-w-0 lg:w-3/5">
          <WebsiteShell
            capturing={loading}
            finalUrl={view === null ? null : view.finalUrl}
            differentHost={view === null ? false : landedOnDifferentHost(view)}
            screenshot={view === null ? null : screenshotSource(view.screenshotBase64)}
          />
        </div>
        <div class="min-w-0 lg:w-2/5">
          {#if view !== null}
            <SnapshotTabs {view} />
          {:else}
            <div class="flex flex-col gap-16">
              <Skeleton class="h-32 w-full" />
              <Skeleton class="h-16 w-full" />
              <Skeleton class="h-16 w-3/4" />
              <Skeleton class="h-16 w-full" />
              <Skeleton class="h-16 w-1/2" />
            </div>
          {/if}
        </div>
      </div>
    {:else if outcome !== null && outcome.kind === "problem"}
      {@const guidance = problemGuidance(outcome.problem)}
      <Alert.Root variant={guidance.tone}>
        <Alert.Title>{guidance.title}</Alert.Title>
        <Alert.Description>
          {guidance.message}
          {#if guidance.tone === "danger" && outcome.problem.errorId}
            <span class="mt-8 block">
              Error ID: <span class="font-mono">{outcome.problem.errorId}</span>
            </span>
          {/if}
        </Alert.Description>
      </Alert.Root>
    {:else if outcome !== null && outcome.kind === "transport"}
      <Alert.Root variant="danger">
        <Alert.Title>The capture service did not respond</Alert.Title>
        <Alert.Description>
          Nothing answered the request. Check your connection, then try again.
        </Alert.Description>
      </Alert.Root>
    {/if}
  </section>
{/if}
