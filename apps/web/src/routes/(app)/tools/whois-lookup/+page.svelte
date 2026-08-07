<script lang="ts">
  /*
   * WHOIS Lookup — pull the registration record for a domain or IP address: who registered it,
   * when, where it is hosted, and its current registry status. The query goes to the same-origin
   * API (a raw fetch — apps/web does not depend on @magna-carta/api-client), and the branching that
   * decides which state to show lives in whois-lookup.ts so it stays testable off the DOM.
   *
   * The query form is the run control and sits in the masthead, so a result rendering below it never
   * reflows the control. The states are all designed honestly: an RDAP registry that answers with no
   * details is a real "nothing found", not a broken card; a legacy port-43 registry returns raw text
   * shown verbatim and labelled unparsed; and a failure surfaces its correlated Error ID. Runs
   * outside any matter and stores nothing.
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
    formatTimestamp,
    lookupWhois,
    problemGuidance,
    type WhoisOutcome,
  } from "$lib/tools/whois/whois-lookup.ts";

  let query = $state("");
  let phase = $state<"idle" | "loading" | "done">("idle");
  let outcome = $state<WhoisOutcome | null>(null);
  // A short summary announced to assistive technology when a Card result arrives. Error, empty, and
  // no-session states render as an Alert, which announces itself via its role, so they are left out
  // of this region to avoid a double reading.
  let announcement = $state("");

  const loading = $derived(phase === "loading");
  const canSubmit = $derived(!loading && query.trim() !== "");

  async function runLookup(event: SubmitEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    const target = query.trim();
    phase = "loading";
    outcome = null;
    announcement = "";
    const result = await lookupWhois(target);
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

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>WHOIS Lookup</Masthead.Title>
    <Masthead.Meta>
      <span>Registration records for a domain or IP address</span>
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <form onsubmit={runLookup} class="flex items-center gap-8">
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
  </Masthead.Actions>
</Masthead.Root>

<!-- Polite live region: announces a found record to a screen reader as it arrives, without
     re-reading the whole card. Alert-rendered states announce themselves through their own role. -->
<div aria-live="polite" class="sr-only">{announcement}</div>

{#if phase === "idle"}
  <div class="flex max-w-xl flex-col gap-8 text-sm text-text-muted">
    <p>Enter a domain name or an IP address to see who registered it and when.</p>
    <p>
      Most registries answer with structured fields. A few country-code registries answer only over
      legacy WHOIS, which comes back as raw text.
    </p>
  </div>
{:else}
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
          <Skeleton class="h-16 w-64" />
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
          <Alert.Title>The lookup service did not respond</Alert.Title>
          <Alert.Description>
            Nothing answered the request. Check your connection, then try again.
          </Alert.Description>
        </Alert.Root>
      {:else if outcome.kind === "empty"}
        <Alert.Root variant="info">
          <Alert.Title>No registration record found</Alert.Title>
          <Alert.Description>
            The RDAP registry answered, but returned no public registration details for
            {outcome.result.target}. The domain may be unregistered, or its registry may not publish
            them.
          </Alert.Description>
        </Alert.Root>
      {:else if outcome.kind === "raw"}
        <Card.Root>
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
                class="overflow-x-auto font-mono text-sm break-words whitespace-pre-wrap text-text-default">{outcome.result.raw}</pre>
            {:else}
              <p class="text-sm text-text-muted">The registry returned no text.</p>
            {/if}
          </Card.Content>
        </Card.Root>
      {:else}
        <Card.Root>
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
                  <dt
                    class="text-xs text-text-muted uppercase sm:w-96 sm:shrink-0"
                    style="letter-spacing: var(--mc-tracking-caps)"
                  >
                    Name servers
                  </dt>
                  <dd class="flex flex-col gap-4 text-sm text-text-default">
                    {#each outcome.result.nameservers as nameserver (nameserver)}
                      <span class="font-mono">{nameserver}</span>
                    {/each}
                  </dd>
                </div>
              {/if}
              {#if outcome.result.statuses && outcome.result.statuses.length > 0}
                <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
                  <dt
                    class="text-xs text-text-muted uppercase sm:w-96 sm:shrink-0"
                    style="letter-spacing: var(--mc-tracking-caps)"
                  >
                    Status
                  </dt>
                  <dd class="flex flex-wrap gap-4">
                    {#each outcome.result.statuses as status (status)}
                      <Badge variant="neutral">{status}</Badge>
                    {/each}
                  </dd>
                </div>
              {/if}
            </dl>
          </Card.Content>
        </Card.Root>
      {/if}
    {/if}
  </section>
{/if}

{#snippet scalarField(label: string, value: string)}
  <div class="flex flex-col gap-4 sm:flex-row sm:gap-16">
    <dt
      class="text-xs text-text-muted uppercase sm:w-96 sm:shrink-0"
      style="letter-spacing: var(--mc-tracking-caps)"
    >
      {label}
    </dt>
    <dd class="text-sm text-text-default">{value}</dd>
  </div>
{/snippet}

<footer class="mt-40 border-t border-border-default pt-16 text-xs text-text-muted">
  The query is checked against public registries only; private, local, and internal addresses are
  refused. This tool runs outside any matter, and nothing is saved — no history, no local storage.
</footer>
