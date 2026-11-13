<script module lang="ts">
  import type { AttemptProgress, WhoisOutcome } from "$lib/tools/whois/whois-lookup.ts";

  /**
   * The page-held registration lookup for the capture's landed host. The page owns and caches it
   * (one entry, keyed by host) so switching tabs never re-queries the registry; this component
   * only renders it and asks for activation.
   */
  export interface RegistrationState {
    host: string;
    loading: boolean;
    /** The attempt now running; past 1 it means the registry faulted and the retry is visible. */
    attempt: AttemptProgress | null;
    outcome: WhoisOutcome | null;
  }
</script>

<script lang="ts">
  /*
   * The inspector half of the safe-browse viewer: everything a capture reports about the suspect
   * page other than its picture, rendered inside the shell's shared frame (the shell draws the one
   * border; the tab strip wears the same sunken chrome register AND the same row height as the
   * address bar — both size from the shell's shared formula — so the frame's top band reads as one
   * continuous bar). The structure renders from page load: with no capture the panels sit empty,
   * while a capture is running each panel is a LoadingRegion over a fixture of its own rows (the
   * same row components the finished capture fills, over sample words, greyed by the recipe), and
   * a completed capture fills them; a panel a capture leaves nothing for (no text, no links, no
   * headers) says so as the region's own empty posture. On wide screens each panel stretches to
   * the frame's remaining height (on stacked narrow screens it keeps a fixed square instead), and
   * each is its own scroll region either way, so switching tabs never reflows the column. A
   * capture that landed on a
   * different site than it was asked for reports that here, on the Overview tab's Different Site
   * row — the warning mark, the landed address, and its copy control — which is that fact's one
   * home; the shell's chrome carries none of it.
   *
   * The Overview tab derives its rows from data already in hand (capture-facts.ts) — nothing is
   * fetched for it. The Registration tab is the one lazy fetch: activating it asks the page (via
   * onactivateregistration) to run the WHOIS lookup for the landed host through the same seam the
   * WHOIS Lookup page uses, with its bounded retries shown as they happen; the page caches the
   * outcome per host so re-opening the tab costs the registry nothing.
   *
   * Everything else stays inert: the extracted text renders as escaped preformatted text, and an
   * outbound link or redirect hop is a button that asks the page to capture that address in the
   * same isolated flow, never an anchor — though it wears the standard link register, because what
   * acts like a link must look like one.
   */
  import * as Alert from "@magna-carta/design-system/alert";
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import * as Tabs from "@magna-carta/design-system/tabs";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Check from "@lucide/svelte/icons/check";
  import Copy from "@lucide/svelte/icons/copy";
  import { QUIET_LINK } from "$lib/auth/quiet-link.ts";
  import { CHROME_ROW_MIN_BLOCK_SIZE } from "./website-shell.svelte";
  import { landedOnDifferentHost, sortedHeaders, type SafeWebsiteView } from "./safe-browse.ts";
  import {
    finalHost,
    finalStatus,
    formatCaptureDuration,
    formatCaptureTime,
    headerValue,
    redirectCount,
  } from "./capture-facts.ts";
  import {
    formatTimestamp,
    problemGuidance as whoisProblemGuidance,
  } from "$lib/tools/whois/whois-lookup.ts";
  import {
    SAMPLE_SENTENCE,
    sampleDate,
    sampleOrganization,
  } from "@magna-carta/design-system/loading-fixtures";

  let {
    view = null,
    capturing = false,
    capturedAt = null,
    elapsedMs = null,
    registration = null,
    onopenaddress,
    onactivateregistration,
  }: {
    /** The completed capture on show, or null while there is nothing to report. */
    view?: SafeWebsiteView | null;
    /** Whether a capture is running — the panels hold their loading fixtures. */
    capturing?: boolean;
    /** When the capture on show completed, epoch milliseconds. */
    capturedAt?: number | null;
    /** How long the capture on show took, milliseconds. */
    elapsedMs?: number | null;
    /** The page's cached registration lookup, or null while none has been asked for. */
    registration?: RegistrationState | null;
    /** Asks the page to capture this address through the same safe flow. */
    onopenaddress?: (url: string) => void;
    /** Asks the page to run (or serve from cache) the landed host's registration lookup. */
    onactivateregistration?: () => void;
  } = $props();

  let activeTab = $state("overview");

  let copiedLanded = $state(false);
  let landedCopyTimer: ReturnType<typeof setTimeout> | null = null;

  async function copyLandedUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      copiedLanded = true;
      if (landedCopyTimer !== null) clearTimeout(landedCopyTimer);
      landedCopyTimer = setTimeout(() => (copiedLanded = false), 1500);
    } catch {
      // The clipboard is unavailable here; nothing was copied, so nothing gets confirmed.
    }
  }

  const headers = $derived(view === null ? [] : sortedHeaders(view.responseHeaders));
  const status = $derived(view === null ? null : finalStatus(view));
  const contentType = $derived(view === null ? null : headerValue(view.responseHeaders, "content-type"));
  const serverName = $derived(view === null ? null : headerValue(view.responseHeaders, "server"));
  const landedHost = $derived(view === null ? null : finalHost(view.finalUrl));

  // Registration is fetched lazily, on activation only — never on every capture, because a
  // registry query costs the registry something. Opening the tab (or having it open when a new
  // capture lands) is the activation; the page dedupes by host, so a cached host costs nothing.
  $effect(() => {
    if (activeTab === "registration" && view !== null) onactivateregistration?.();
  });

  const registrationCurrent = $derived(
    registration !== null && landedHost !== null && registration.host === landedHost
      ? registration
      : null,
  );
  const registrationRetrying = $derived(
    registrationCurrent !== null &&
      registrationCurrent.attempt !== null &&
      registrationCurrent.attempt.attempt > 1,
  );
  // The Registration panel is loading while a capture is on show and its host's record has not
  // been asked for yet, or is still being answered. With no capture there is nothing to read.
  const registrationPending = $derived(
    view !== null && (registrationCurrent === null || registrationCurrent.loading),
  );

  /** Every panel's scroll region: a square on stacked screens, the frame's height beside it. */
  const PANEL_CLASS = "mc-scrollbar aspect-square overflow-y-auto p-12 lg:aspect-auto lg:h-full";

  // Sample words for the loading fixtures: an invented newsletter address, never a real capture.
  // Dates, the registrant and running text come from the sample vocabulary; addresses, headers,
  // a page title and a registration record's own kinds of word have no sample there and stay here.
  const FIXTURE_PAGE_TITLE = "Quarterly newsletter offer";
  const FIXTURE_DOMAIN = "example.com";
  const FIXTURE_REGISTRAR = "Example Registrar, Inc.";
  const FIXTURE_REGISTRANT = sampleOrganization(1).name;
  const FIXTURE_NAME_SERVERS = ["a.iana-servers.net", "b.iana-servers.net"];
  const FIXTURE_REQUESTED_ADDRESS = "https://example.com/newsletter/offer";
  const FIXTURE_LANDED_ADDRESS = "https://www.example.com/newsletter/offer/";
  const FIXTURE_OUTBOUND_ADDRESSES = [
    "https://www.example.com/about/",
    "https://www.example.com/contact/",
    "https://status.example.com/",
  ];
  const FIXTURE_HEADERS: readonly (readonly [string, string])[] = [
    ["cache-control", "max-age=0, private, must-revalidate"],
    ["content-type", "text/html; charset=utf-8"],
    ["server", "cloudflare"],
  ];
</script>

<Tabs.Root bind:value={activeTab} class="gap-0 lg:min-h-0 lg:flex-1">
  <!-- The strip stretches to the shell's shared chrome-row height so its bottom hairline meets
       the address bar's as one line; the stretched triggers keep the active indicator on that
       shared edge. -->
  <div class="mc-scrollbar flex overflow-x-auto bg-surface-sunken">
    <Tabs.List class="w-max min-w-full items-stretch" style={CHROME_ROW_MIN_BLOCK_SIZE}>
      <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
      <Tabs.Trigger value="redirects">Redirects</Tabs.Trigger>
      <Tabs.Trigger value="page-text">Page Text</Tabs.Trigger>
      <Tabs.Trigger value="links">Links</Tabs.Trigger>
      <Tabs.Trigger value="headers">Headers</Tabs.Trigger>
      <Tabs.Trigger value="registration">Registration</Tabs.Trigger>
    </Tabs.List>
  </div>

  <Tabs.Content value="overview" class="lg:min-h-0 lg:flex-1">
    <LoadingRegion loading={capturing} label="Reading what the capture found" class={PANEL_CLASS}>
      {#snippet fixture()}
        <dl class="flex flex-col divide-y divide-border-default">
          {@render factRow("Final Status", "200", true)}
          {@render factRow("Content Type", "text/html; charset=utf-8", true)}
          {@render factRow("Server", "cloudflare", true)}
          {@render factRow("Redirects", "1", false)}
          {@render factRow("Outbound Links", "18", false)}
          {@render factRow("Page Title", FIXTURE_PAGE_TITLE, false)}
          {@render factRow("Captured", sampleDate(0), false)}
          {@render factRow("Capture Duration", "6.2 s", false)}
        </dl>
      {/snippet}
      {#if view !== null}
        <dl class="flex flex-col divide-y divide-border-default">
          {#if status !== null}
            {@render factRow("Final Status", String(status), true)}
          {/if}
          {#if contentType !== null}
            {@render factRow("Content Type", contentType, true)}
          {/if}
          {#if serverName !== null}
            {@render factRow("Server", serverName, true)}
          {/if}
          {@render factRow("Redirects", String(redirectCount(view)), false)}
          {@render factRow("Outbound Links", String(view.links.length), false)}
          {#if view.title}
            {@render factRow("Page Title", view.title, false)}
          {/if}
          {#if landedOnDifferentHost(view)}
            {@const landedAddress = view.finalUrl}
            <!-- The one home of the different-site fact: the warning mark, the landed address in
                 full, and its own copy control. Text, never an anchor. -->
            <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
              <dt><Badge variant="warning">Different Site</Badge></dt>
              <dd class="flex min-w-0 items-center gap-8">
                <span class="min-w-0 flex-1 font-mono text-sm break-all text-text-default">
                  {landedAddress}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  class="shrink-0"
                  aria-label={copiedLanded ? "Copied" : "Copy Landed Address"}
                  onclick={() => copyLandedUrl(landedAddress)}
                >
                  {#if copiedLanded}
                    <Check class="size-16" aria-hidden="true" />
                  {:else}
                    <Copy class="size-16" aria-hidden="true" />
                  {/if}
                </Button>
              </dd>
            </div>
          {/if}
          {#if capturedAt !== null}
            {@render factRow("Captured", formatCaptureTime(capturedAt), false)}
          {/if}
          {#if elapsedMs !== null}
            {@render factRow("Capture Duration", formatCaptureDuration(elapsedMs), false)}
          {/if}
        </dl>
      {/if}
    </LoadingRegion>
  </Tabs.Content>

  <Tabs.Content value="redirects" class="lg:min-h-0 lg:flex-1">
    <LoadingRegion
      loading={capturing}
      label="Reading the capture's redirect chain"
      class={PANEL_CLASS}
    >
      {#snippet fixture()}
        <dl class="flex flex-col divide-y divide-border-default">
          {@render addressField("Requested URL", FIXTURE_REQUESTED_ADDRESS)}
          {@render addressField("Final URL", FIXTURE_LANDED_ADDRESS)}
          <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
            {@render fieldLabel("Page Title")}
            <dd class="min-w-0 text-sm break-words text-text-default">{FIXTURE_PAGE_TITLE}</dd>
          </div>
          <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
            {@render fieldLabel("Redirect Chain")}
            <dd class="min-w-0">
              <ol class="flex flex-col divide-y divide-border-default">
                <li class="flex items-baseline gap-8 py-4 first:pt-0 last:pb-0">
                  <span class="shrink-0 text-xs text-text-muted">301</span>
                  {@render addressButton(FIXTURE_REQUESTED_ADDRESS)}
                </li>
                <li class="flex items-baseline gap-8 py-4 first:pt-0 last:pb-0">
                  <span class="shrink-0 text-xs text-text-muted">200</span>
                  {@render addressButton(FIXTURE_LANDED_ADDRESS)}
                </li>
              </ol>
            </dd>
          </div>
        </dl>
      {/snippet}
      {#if view !== null}
        <dl class="flex flex-col divide-y divide-border-default">
          {@render addressField("Requested URL", view.requestedUrl)}
          {@render addressField("Final URL", view.finalUrl)}
          {#if view.title}
            <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
              {@render fieldLabel("Page Title")}
              <dd class="min-w-0 text-sm break-words text-text-default">{view.title}</dd>
            </div>
          {/if}
          <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
            {@render fieldLabel("Redirect Chain")}
            <dd class="min-w-0">
              {#if view.redirectChain.length > 0}
                <ol class="flex flex-col divide-y divide-border-default">
                  {#each view.redirectChain as hop, index (index)}
                    <li class="flex items-baseline gap-8 py-4 first:pt-0 last:pb-0">
                      <span class="shrink-0 text-xs text-text-muted">{hop.status}</span>
                      {@render addressButton(hop.url)}
                    </li>
                  {/each}
                </ol>
              {:else}
                <p class="text-sm text-text-muted">
                  The address answered directly, with no redirects.
                </p>
              {/if}
            </dd>
          </div>
        </dl>
      {/if}
    </LoadingRegion>
  </Tabs.Content>

  <Tabs.Content value="page-text" class="lg:min-h-0 lg:flex-1">
    <LoadingRegion
      loading={capturing}
      empty={view !== null && !view.markdown}
      label="Reading the captured page's text"
      class={PANEL_CLASS}
    >
      {#snippet fixture()}
        <!-- Three lines of running text, in the extracted text's own face. -->
        <div class="flex flex-col gap-4">
          <p class="font-mono text-sm text-text-default">{FIXTURE_PAGE_TITLE}</p>
          <p class="font-mono text-sm text-text-default">{SAMPLE_SENTENCE}</p>
          <p class="font-mono text-sm text-text-default">{SAMPLE_SENTENCE}</p>
        </div>
      {/snippet}
      {#snippet emptyState()}
        <p class="text-sm text-text-muted">The capture returned no page text.</p>
      {/snippet}
      {#if view !== null && view.markdown}
        <pre
          class="font-mono text-sm break-words whitespace-pre-wrap text-text-default">{view.markdown}</pre>
      {/if}
    </LoadingRegion>
  </Tabs.Content>

  <Tabs.Content value="links" class="lg:min-h-0 lg:flex-1">
    <LoadingRegion
      loading={capturing}
      empty={view !== null && view.links.length === 0}
      label="Reading the captured page's outbound addresses"
      class={PANEL_CLASS}
    >
      {#snippet fixture()}
        <ul class="flex flex-col divide-y divide-border-default">
          {#each FIXTURE_OUTBOUND_ADDRESSES as address (address)}
            <li class="min-w-0 py-8 first:pt-0 last:pb-0">
              {@render addressButton(address)}
            </li>
          {/each}
        </ul>
      {/snippet}
      {#snippet emptyState()}
        <p class="text-sm text-text-muted">The page links out to no addresses.</p>
      {/snippet}
      {#if view !== null && view.links.length > 0}
        <FieldLabel as="p" class="mb-8"
        >
          {view.links.length === 1
            ? "1 outbound address"
            : `${view.links.length} outbound addresses`}
        </FieldLabel>
        <ul class="flex flex-col divide-y divide-border-default">
          {#each view.links as link, index (index)}
            <li class="min-w-0 py-8 first:pt-0 last:pb-0">
              {@render addressButton(link)}
            </li>
          {/each}
        </ul>
      {/if}
    </LoadingRegion>
  </Tabs.Content>

  <Tabs.Content value="headers" class="lg:min-h-0 lg:flex-1">
    <LoadingRegion
      loading={capturing}
      empty={view !== null && headers.length === 0}
      label="Reading the response headers"
      class={PANEL_CLASS}
    >
      {#snippet fixture()}
        <dl class="flex flex-col divide-y divide-border-default">
          {#each FIXTURE_HEADERS as [name, value] (name)}
            <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
              <dt class="min-w-0 font-mono text-xs break-all text-text-muted">{name}</dt>
              <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
            </div>
          {/each}
        </dl>
      {/snippet}
      {#snippet emptyState()}
        <p class="text-sm text-text-muted">The response carried no headers.</p>
      {/snippet}
      {#if view !== null && headers.length > 0}
        <dl class="flex flex-col divide-y divide-border-default">
          {#each headers as [name, value] (name)}
            <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
              <dt class="min-w-0 font-mono text-xs break-all text-text-muted">{name}</dt>
              <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
            </div>
          {/each}
        </dl>
      {/if}
    </LoadingRegion>
  </Tabs.Content>

  <Tabs.Content value="registration" class="lg:min-h-0 lg:flex-1">
    <!-- Loading while the capture runs and again while the landed host's record is looked up. A
         visible retry keeps its line at the top of the fixture, real and readable
         (data-loading-keep): a bounded retry is shown as it happens, never hidden in the grey. -->
    <LoadingRegion
      loading={capturing || registrationPending}
      label="Looking up the landed host's registration record"
      class={PANEL_CLASS}
    >
      {#snippet fixture()}
        {#if !capturing && registrationRetrying && registrationCurrent?.attempt}
          {@const attempt = registrationCurrent.attempt}
          <div data-loading-keep class="mb-8 flex flex-wrap items-center gap-8">
            <Badge variant="warning">Retrying</Badge>
            <span class="text-sm text-text-muted">
              The registry didn't respond. Trying again, attempt {attempt.attempt} of {attempt.maxAttempts}…
            </span>
          </div>
        {/if}
        <dl class="flex flex-col divide-y divide-border-default">
          {@render factRow("Domain", FIXTURE_DOMAIN, true)}
          {@render factRow("Registrar", FIXTURE_REGISTRAR, false)}
          {@render factRow("Registered", sampleDate(2), false)}
          {@render factRow("Expires", sampleDate(3), false)}
          {@render factRow("Registrant", FIXTURE_REGISTRANT, false)}
          <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
            {@render fieldLabel("Name Servers")}
            <dd class="flex min-w-0 flex-col gap-4">
              {#each FIXTURE_NAME_SERVERS as nameserver (nameserver)}
                <span class="font-mono text-sm break-all text-text-default">{nameserver}</span>
              {/each}
            </dd>
          </div>
        </dl>
      {/snippet}
      {#if registrationCurrent !== null && registrationCurrent.outcome !== null}
        {@const outcome = registrationCurrent.outcome}
        {#if outcome.kind === "problem"}
          {@const guidance = whoisProblemGuidance(outcome.problem)}
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
            <Alert.Title>The lookup service did not respond</Alert.Title>
            <Alert.Description>
              Couldn't connect. Check your connection and try again.
            </Alert.Description>
          </Alert.Root>
        {:else if outcome.kind === "empty"}
          <Alert.Root variant="info">
            <Alert.Title>No registration record found</Alert.Title>
            <Alert.Description>
              The registry answered, but has no public registration details for {outcome.result.target}. The domain may be unregistered, or its registry may not publish them.
            </Alert.Description>
          </Alert.Root>
        {:else if outcome.kind === "raw"}
          <div class="mb-8 flex flex-wrap items-center gap-8">
            <span class="min-w-0 truncate font-mono text-sm text-text-default">
              {outcome.result.target}
            </span>
            <Badge variant="neutral" class="shrink-0">WHOIS · port 43</Badge>
          </div>
          {#if outcome.result.raw}
            <pre
              class="font-mono text-sm break-words whitespace-pre-wrap text-text-default">{outcome
                .result.raw}</pre>
          {:else}
            <p class="text-sm text-text-muted">The registry returned no text.</p>
          {/if}
        {:else}
          <dl class="flex flex-col divide-y divide-border-default">
            {@render factRow("Domain", outcome.result.target, true)}
            {#if outcome.result.registrar}
              {@render factRow("Registrar", outcome.result.registrar, false)}
            {/if}
            {#if outcome.result.registeredAt}
              {@render factRow("Registered", formatTimestamp(outcome.result.registeredAt), false)}
            {/if}
            {#if outcome.result.expiresAt}
              {@render factRow("Expires", formatTimestamp(outcome.result.expiresAt), false)}
            {/if}
            {#if outcome.result.lastChangedAt}
              {@render factRow(
                "Last Changed",
                formatTimestamp(outcome.result.lastChangedAt),
                false,
              )}
            {/if}
            {#if outcome.result.registrant}
              {@render factRow("Registrant", outcome.result.registrant, false)}
            {/if}
            {#if outcome.result.nameservers && outcome.result.nameservers.length > 0}
              <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
                {@render fieldLabel("Name Servers")}
                <dd class="flex min-w-0 flex-col gap-4">
                  {#each outcome.result.nameservers as nameserver (nameserver)}
                    <span class="font-mono text-sm break-all text-text-default">{nameserver}</span>
                  {/each}
                </dd>
              </div>
            {/if}
            {#if outcome.result.statuses && outcome.result.statuses.length > 0}
              <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
                {@render fieldLabel("Status")}
                <dd class="flex flex-wrap gap-4">
                  {#each outcome.result.statuses as registryStatus (registryStatus)}
                    <Badge variant="neutral">{registryStatus}</Badge>
                  {/each}
                </dd>
              </div>
            {/if}
          </dl>
        {/if}
      {/if}
    </LoadingRegion>
  </Tabs.Content>
</Tabs.Root>

{#snippet fieldLabel(label: string)}
  <FieldLabel as="dt" class="shrink-0"
  >
    {label}
  </FieldLabel>
{/snippet}

{#snippet factRow(label: string, value: string, mono: boolean)}
  <div class="flex items-baseline justify-between gap-8 py-8 first:pt-0 last:pb-0">
    {@render fieldLabel(label)}
    <dd
      class="min-w-0 text-right text-sm break-words text-text-default {mono ? 'font-mono' : ''}"
    >
      {value}
    </dd>
  </div>
{/snippet}

{#snippet addressField(label: string, value: string)}
  <div class="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
    {@render fieldLabel(label)}
    <dd class="min-w-0 font-mono text-sm break-all text-text-default">{value}</dd>
  </div>
{/snippet}

<!-- An address the member can open in the viewer: a button that asks the page for a new capture —
     never an anchor, nothing here navigates their browser — wearing the standard link register
     (link color, underline, pointer), because what acts like a link must look like one. -->
{#snippet addressButton(url: string)}
  <button
    type="button"
    class="{QUIET_LINK} min-w-0 text-left font-mono break-all underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline"
    disabled={capturing || onopenaddress === undefined}
    onclick={() => onopenaddress?.(url)}
  >
    {url}
  </button>
{/snippet}
