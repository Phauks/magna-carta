<script lang="ts">
  /*
   * WHOIS Lookup — pull the registration record for a domain or IP address: who registered it,
   * when, where it is hosted, and its current registry status. The query goes to the same-origin
   * API (a raw fetch — apps/web does not depend on @magna-carta/api-client), and the branching that
   * decides which state to show lives in whois-lookup.ts so it stays testable off the DOM.
   *
   * The query form is the run control and sits at the content's reading edge below the masthead;
   * it carries no info prose around it (docs/conventions/design-corrections.md, "No info lines"),
   * and a result rendering below never reflows it. The result card is furniture: its frame
   * renders from page load, holding the record's field rows empty and calm, and every later
   * state — the parsed record, raw registry text, an alert — renders inside that same frame, so
   * a lookup populates a shape already there instead of appearing. While the lookup is out the
   * card is a LoadingRegion over the same card with sample words in its rows, and a visible retry
   * keeps its line in the card's header, real and readable, because a bounded retry is shown as
   * it happens. The region holds the lookup's whole state set: a registry problem or a silent
   * service is its failed posture, an RDAP answer with no details its empty posture, and each
   * renders as an alert inside the same frame. The states are all designed honestly: an RDAP
   * registry that answers with no details is a real "nothing found", not a broken card; a legacy
   * port-43 registry returns raw text shown verbatim and labelled unparsed; and a failure surfaces
   * its correlated Error ID. Runs outside any matter and stores nothing.
   */
  import Badge from "@magna-carta/design-system/badge";
  import Button from "@magna-carta/design-system/button";
  import Input from "@magna-carta/design-system/input";
  import Label from "@magna-carta/design-system/label";
  import * as Alert from "@magna-carta/design-system/alert";
  import * as Card from "@magna-carta/design-system/card";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import LoadingRegion from "@magna-carta/design-system/loading-region";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { sampleDate, sampleOrganization } from "@magna-carta/design-system/loading-fixtures";
  import {
    formatTimestamp,
    lookupWhoisWithRetries,
    problemGuidance,
    type AttemptProgress,
    type WhoisOutcome,
  } from "$lib/tools/whois/whois-lookup.ts";

  let query = $state("");
  let phase = $state<"idle" | "loading" | "done">("idle");
  let outcome = $state<WhoisOutcome | null>(null);
  // The attempt now running. A first attempt is the ordinary loading state; a second or third is
  // the registry having faulted once already, and the retry line below makes that visible instead
  // of a silent stall.
  let attempt = $state<AttemptProgress | null>(null);
  // A short summary announced to assistive technology when a Card result arrives. Error, empty, and
  // no-session states render as an Alert, which announces itself via its role, so they are left out
  // of this region to avoid a double reading.
  let announcement = $state("");

  const loading = $derived(phase === "loading");
  const canSubmit = $derived(!loading && query.trim() !== "");
  const retrying = $derived(attempt !== null && attempt.attempt > 1);
  // The registry faulting or the service not answering is the lookup failing; an RDAP answer with
  // no details is the lookup finding nothing. Both are the region's own postures.
  const lookupFailed = $derived(
    outcome !== null && (outcome.kind === "problem" || outcome.kind === "transport"),
  );
  const lookupEmpty = $derived(outcome !== null && outcome.kind === "empty");
  // What was last asked for, so a stalled lookup can be asked again as it was.
  let lastTarget: string | null = null;

  // The record's field rows, drawn empty at rest so the result card is furniture from page load:
  // a lookup populates a shape already on the screen instead of making one appear.
  const restingFieldLabels = [
    "Registrar",
    "Registered",
    "Expires",
    "Last changed",
    "Registrant",
    "Name servers",
    "Status",
  ];

  // Sample words for the loading fixture: the parsed record's own rows over an invented record.
  // The registrant and the dates come from the sample vocabulary; the domain, registrar, name
  // servers and registry statuses are this record's own kinds of word, which it carries no sample of.
  const FIXTURE_DOMAIN = "example.com";
  const FIXTURE_REGISTRAR = "Example Registrar, Inc.";
  const FIXTURE_REGISTRANT = sampleOrganization(1).name;
  const FIXTURE_NAME_SERVERS = ["a.iana-servers.net", "b.iana-servers.net"];
  const FIXTURE_STATUSES = ["client delete prohibited", "client transfer prohibited"];

  async function runLookup(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    await lookup(query.trim());
  }

  function retryLookup(): void {
    if (lastTarget === null || loading) return;
    void lookup(lastTarget);
  }

  async function lookup(target: string): Promise<void> {
    lastTarget = target;
    phase = "loading";
    outcome = null;
    attempt = null;
    announcement = "";
    const result = await lookupWhoisWithRetries(target, (progress) => {
      attempt = progress;
      if (progress.attempt > 1) {
        announcement = `The registry didn't respond. Trying again, attempt ${progress.attempt} of ${progress.maxAttempts}.`;
      }
    });
    outcome = result;
    phase = "done";
    if (result.kind === "rdap") {
      announcement = `Registration found for ${result.result.target}.`;
    } else if (result.kind === "raw") {
      announcement = `Unparsed registry text returned for ${result.result.target}.`;
    }
  }
</script>

<svelte:head><title>WHOIS Lookup · Magna Carta</title></svelte:head>

<ScreenHeader title="WHOIS Lookup" class="mb-24" />

<form onsubmit={runLookup} class="mb-16 flex items-center gap-8">
  <Label for="whois-query" class="sr-only">Domain or IP address</Label>
  <Input
    id="whois-query"
    name="query"
    class="w-3xs"
    bind:value={query}
    placeholder="example.com or 8.8.8.8"
    autocomplete="off"
    autocapitalize="none"
    spellcheck={false}
    disabled={loading}
  />
  <Button type="submit" variant="primary" disabled={!canSubmit}>
    {loading ? "Looking up…" : "Look up"}
  </Button>
</form>

<!-- Polite live region: announces a found record to a screen reader as it arrives, without
     re-reading the whole card. Alert-rendered states announce themselves through their own role. -->
<div aria-live="polite" class="sr-only">{announcement}</div>

<section>
  <FieldLabel as="h2" class="mb-16 border-b border-border-strong pb-8"
  >
    Result
  </FieldLabel>

  <!-- The result frame is furniture: one Card renders from page load and every state fills it.
       At rest it holds the record's field rows, empty and calm; while the lookup is out the
       region renders the same card over sample words, greyed. -->
  <LoadingRegion
    {loading}
    failed={lookupFailed}
    empty={lookupEmpty}
    label="Looking up the registration record"
    onRetry={retryLookup}
  >
    {#snippet failure()}
      <Card.Root>
        <Card.Content>
          {#if outcome !== null && outcome.kind === "problem"}
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
          {:else}
            <Alert.Root variant="danger">
              <Alert.Title>The lookup service did not respond</Alert.Title>
              <Alert.Description>
                Couldn't connect. Check your connection and try again.
              </Alert.Description>
            </Alert.Root>
          {/if}
        </Card.Content>
      </Card.Root>
    {/snippet}
    {#snippet emptyState()}
      {#if outcome !== null && outcome.kind === "empty"}
        <Card.Root>
          <Card.Content>
            <Alert.Root variant="info">
              <Alert.Title>No registration record found</Alert.Title>
              <Alert.Description>
                The RDAP registry answered, but returned no public registration details for
                {outcome.result.target}. The domain may be unregistered, or its registry may not
                publish them.
              </Alert.Description>
            </Alert.Root>
          </Card.Content>
        </Card.Root>
      {/if}
    {/snippet}
    {#snippet fixture()}
      <Card.Root>
        <Card.Header>
          {#if retrying && attempt !== null}
            <!-- The retry stays real inside the fixture: a member is never made to guess whether
                 a stalled lookup is the registry faulting or the page. -->
            <div data-loading-keep class="flex flex-wrap items-center gap-8">
              <Badge variant="warning">Retrying</Badge>
              <span class="text-sm text-text-muted">
                The registry didn't respond. Trying again, attempt {attempt.attempt} of {attempt.maxAttempts}…
              </span>
            </div>
          {:else}
            <div class="flex flex-wrap items-center gap-8">
              <Card.Title><span>{FIXTURE_DOMAIN}</span></Card.Title>
              <Badge variant="info">RDAP</Badge>
            </div>
            <Card.Description>
              <span>Structured registration record, parsed from RDAP.</span>
            </Card.Description>
          {/if}
        </Card.Header>
        <Card.Content>
          <dl class="flex flex-col gap-16">
            {@render scalarField("Registrar", FIXTURE_REGISTRAR)}
            {@render scalarField("Registered", sampleDate(2))}
            {@render scalarField("Expires", sampleDate(3))}
            {@render scalarField("Last changed", sampleDate(1))}
            {@render scalarField("Registrant", FIXTURE_REGISTRANT)}
            <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
              <FieldLabel as="dt" class="sm:w-96 sm:shrink-0"
              >
                Name servers
              </FieldLabel>
              <dd class="flex flex-col gap-4 text-sm text-text-default">
                {#each FIXTURE_NAME_SERVERS as nameserver (nameserver)}
                  <span class="font-mono">{nameserver}</span>
                {/each}
              </dd>
            </div>
            <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
              <FieldLabel as="dt" class="sm:w-96 sm:shrink-0"
              >
                Status
              </FieldLabel>
              <dd class="flex flex-wrap gap-4">
                {#each FIXTURE_STATUSES as status (status)}
                  <Badge variant="neutral">{status}</Badge>
                {/each}
              </dd>
            </div>
          </dl>
        </Card.Content>
      </Card.Root>
    {/snippet}

    <Card.Root>
      {#if phase === "idle"}
        <Card.Content>
          <dl class="flex flex-col gap-16">
            {#each restingFieldLabels as label (label)}
              <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
                <FieldLabel as="dt" class="sm:w-96 sm:shrink-0"
                >
                  {label}
                </FieldLabel>
                <dd class="text-sm text-text-default"></dd>
              </div>
            {/each}
          </dl>
        </Card.Content>
      {:else if outcome !== null}
        {#if outcome.kind === "raw"}
          <Card.Header>
            <div class="flex flex-wrap items-center gap-8">
              <Card.Title>{outcome.result.target}</Card.Title>
              <Badge variant="neutral">WHOIS · port 43</Badge>
            </div>
            <Card.Description>
              Raw text from the registry's legacy WHOIS service, shown exactly as returned. It is not
              parsed into fields.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            {#if outcome.result.raw}
              <pre
                class="mc-scrollbar overflow-x-auto font-mono text-sm break-words whitespace-pre-wrap text-text-default">{outcome.result.raw}</pre>
            {:else}
              <p class="text-sm text-text-muted">The registry returned no text.</p>
            {/if}
          </Card.Content>
        {:else if outcome.kind === "rdap"}
          <Card.Header>
            <div class="flex flex-wrap items-center gap-8">
              <Card.Title>{outcome.result.target}</Card.Title>
              <Badge variant="info">RDAP</Badge>
            </div>
            <Card.Description>Structured registration record, parsed from RDAP.</Card.Description>
          </Card.Header>
          <Card.Content>
            <dl class="flex flex-col gap-16">
              {#if outcome.result.registrar}
                {@render scalarField("Registrar", outcome.result.registrar)}
              {/if}
              {#if outcome.result.registeredAt}
                {@render scalarField("Registered", formatTimestamp(outcome.result.registeredAt))}
              {/if}
              {#if outcome.result.expiresAt}
                {@render scalarField("Expires", formatTimestamp(outcome.result.expiresAt))}
              {/if}
              {#if outcome.result.lastChangedAt}
                {@render scalarField("Last changed", formatTimestamp(outcome.result.lastChangedAt))}
              {/if}
              {#if outcome.result.registrant}
                {@render scalarField("Registrant", outcome.result.registrant)}
              {/if}
              {#if outcome.result.nameservers && outcome.result.nameservers.length > 0}
                <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
                  <FieldLabel as="dt" class="sm:w-96 sm:shrink-0"
                  >
                    Name servers
                  </FieldLabel>
                  <dd class="flex flex-col gap-4 text-sm text-text-default">
                    {#each outcome.result.nameservers as nameserver (nameserver)}
                      <span class="font-mono">{nameserver}</span>
                    {/each}
                  </dd>
                </div>
              {/if}
              {#if outcome.result.statuses && outcome.result.statuses.length > 0}
                <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
                  <FieldLabel as="dt" class="sm:w-96 sm:shrink-0"
                  >
                    Status
                  </FieldLabel>
                  <dd class="flex flex-wrap gap-4">
                    {#each outcome.result.statuses as status (status)}
                      <Badge variant="neutral">{status}</Badge>
                    {/each}
                  </dd>
                </div>
              {/if}
            </dl>
          </Card.Content>
        {/if}
      {/if}
    </Card.Root>
  </LoadingRegion>
</section>

{#snippet scalarField(label: string, value: string)}
  <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
    <FieldLabel as="dt" class="sm:w-96 sm:shrink-0"
    >
      {label}
    </FieldLabel>
    <dd class="text-sm text-text-default">{value}</dd>
  </div>
{/snippet}
