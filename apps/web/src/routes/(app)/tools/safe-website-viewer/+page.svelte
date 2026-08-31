<script lang="ts">
  /*
   * Safe Website Viewer — open an untrusted website at arm's length. The member pastes a suspect
   * link; the worker opens it in Cloudflare's isolated remote browser and returns a static
   * snapshot: a screenshot, the extracted text, the redirect chain, and the response headers. The
   * suspect page never loads in the member's browser, and everything shown here stays inert: the
   * screenshot is a plain image, the extracted text renders as escaped preformatted text, and the
   * page's outbound links render as text only, never as anchors. The fetch and the branching that
   * decides which state to show live in safe-browse.ts so they stay testable off the DOM.
   *
   * The query form is the run control and sits at the content's reading edge below the masthead,
   * above the intro text, which stays visible through every state — so a result rendering below
   * never reflows the control or the copy above it. The states are designed honestly: a capture
   * that came back without a screenshot says so instead of showing a broken image, a link that
   * landed on a different site than it started on is called out plainly, and a failure surfaces
   * its correlated Error ID. Runs outside any matter and stores nothing.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Card from "@magna-carta/design-system/card";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import Skeleton from "@magna-carta/design-system/skeleton";
  import {
    landedOnDifferentHost,
    normalizeTarget,
    problemGuidance,
    screenshotSource,
    sortedHeaders,
    viewSafely,
    type SafeBrowseOutcome,
  } from "$lib/tools/safe-browse/safe-browse.ts";

  let query = $state("");
  let phase = $state<"idle" | "loading" | "done">("idle");
  let outcome = $state<SafeBrowseOutcome | null>(null);
  // A short summary announced to assistive technology when the snapshot cards arrive. Problem and
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
     whole card set. Alert-rendered states announce themselves through their own role. -->
<div aria-live="polite" class="sr-only">{announcement}</div>

<p class="mb-24 max-w-xl text-sm text-text-muted">
  Paste a link you do not trust to see what is behind it without visiting it. The address is opened
  in an isolated remote browser, and what comes back is a static screenshot and plain facts: where
  the link really leads, what the page says, and which addresses it points at. The live page never
  reaches your browser.
</p>

{#if phase !== "idle"}
  <section aria-busy={loading}>
    <h2
      class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      Result
    </h2>

    {#if loading}
      <Card.Root>
        <Card.Header>
          <Skeleton class="h-20 w-96" />
        </Card.Header>
        <Card.Content class="flex flex-col gap-12">
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-16 w-full" />
          <Skeleton class="h-96 w-full" />
        </Card.Content>
      </Card.Root>
    {:else if outcome}
      {#if outcome.kind === "problem"}
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
      {:else if outcome.kind === "transport"}
        <Alert.Root variant="danger">
          <Alert.Title>The Capture Service Did Not Respond</Alert.Title>
          <Alert.Description>
            Nothing answered the request. Check your connection, then try again.
          </Alert.Description>
        </Alert.Root>
      {:else}
        {@const view = outcome.view}
        {@const screenshot = screenshotSource(view.screenshotBase64)}
        {@const headers = sortedHeaders(view.responseHeaders)}
        <div class="flex flex-col gap-16">
          <Card.Root>
            <Card.Header>
              <div class="flex flex-wrap items-center gap-8">
                <Card.Title>{view.title ? view.title : "Untitled Page"}</Card.Title>
                {#if landedOnDifferentHost(view)}
                  <Badge variant="warning">Different Site</Badge>
                {/if}
              </div>
              <Card.Description>
                {#if landedOnDifferentHost(view)}
                  The capture started at the address you entered and ended on a different site;
                  check the redirect chain below before trusting the link. Nothing shown here is
                  live.
                {:else}
                  What the isolated browser saw when it opened the address. Nothing shown here is
                  live.
                {/if}
              </Card.Description>
            </Card.Header>
            <Card.Content class="flex flex-col gap-16">
              <dl class="flex flex-col gap-16">
                {@render addressField("Requested URL", view.requestedUrl)}
                {@render addressField("Final URL", view.finalUrl)}
                {#if view.redirectChain.length > 0}
                  <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
                    <dt
                      class="text-xs text-text-muted uppercase sm:w-96 sm:shrink-0"
                      style="letter-spacing: var(--mc-tracking-caps)"
                    >
                      Redirects
                    </dt>
                    <dd class="min-w-0">
                      <ol class="flex flex-col gap-4 text-sm text-text-default">
                        {#each view.redirectChain as hop, index (index)}
                          <li class="flex items-baseline gap-8">
                            <span class="shrink-0 text-xs text-text-muted">{hop.status}</span>
                            <span class="min-w-0 font-mono break-all">{hop.url}</span>
                          </li>
                        {/each}
                      </ol>
                    </dd>
                  </div>
                {/if}
              </dl>
            </Card.Content>
          </Card.Root>

          <Card.Root>
            <Card.Header>
              <Card.Title>Screenshot</Card.Title>
              <Card.Description>
                A static image of the page as the isolated browser rendered it. It cannot run
                anything.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              {#if screenshot}
                <img
                  src={screenshot}
                  alt="Static screenshot of the captured page"
                  class="max-w-full border border-border-default"
                />
              {:else}
                <p class="text-sm text-text-muted">
                  The renderer returned no screenshot for this page.
                </p>
              {/if}
            </Card.Content>
          </Card.Root>

          {#if view.markdown}
            <Card.Root>
              <Card.Header>
                <Card.Title>Extracted Text</Card.Title>
                <Card.Description>
                  The page's text, extracted by the remote browser and shown verbatim. It is not
                  rendered as markup.
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <pre
                  class="overflow-x-auto font-mono text-sm break-words whitespace-pre-wrap text-text-default">{view.markdown}</pre>
              </Card.Content>
            </Card.Root>
          {/if}

          {#if view.links.length > 0}
            <Card.Root>
              <Card.Header>
                <Card.Title>Outbound Links</Card.Title>
                <Card.Description>
                  {view.links.length === 1
                    ? "1 address the page links out to"
                    : `${view.links.length} addresses the page links out to`}, shown as text only.
                  None of them is clickable here.
                </Card.Description>
              </Card.Header>
              <Card.Content>
                <ul class="flex flex-col gap-4">
                  {#each view.links as link, index (index)}
                    <li class="min-w-0 font-mono text-sm break-all text-text-default">{link}</li>
                  {/each}
                </ul>
              </Card.Content>
            </Card.Root>
          {/if}

          <Card.Root>
            <Card.Header>
              <Card.Title>Response Headers</Card.Title>
              <Card.Description>
                The headers the final response arrived with, sorted by name.
              </Card.Description>
            </Card.Header>
            <Card.Content>
              {#if headers.length > 0}
                <dl class="flex flex-col gap-8">
                  {#each headers as [name, value] (name)}
                    <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
                      <dt class="font-mono text-xs break-all text-text-muted sm:w-96 sm:shrink-0">
                        {name}
                      </dt>
                      <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
                    </div>
                  {/each}
                </dl>
              {:else}
                <p class="text-sm text-text-muted">The response carried no headers.</p>
              {/if}
            </Card.Content>
          </Card.Root>
        </div>
      {/if}
    {/if}
  </section>
{/if}

{#snippet addressField(label: string, value: string)}
  <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
    <dt
      class="text-xs text-text-muted uppercase sm:w-96 sm:shrink-0"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      {label}
    </dt>
    <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
  </div>
{/snippet}

<footer class="mt-40 border-t border-border-default pt-16 text-xs text-text-muted">
  The address is checked against public sites only; private, local, and internal addresses are
  refused. This tool runs outside any matter, and nothing is saved: no history, no local storage.
</footer>
