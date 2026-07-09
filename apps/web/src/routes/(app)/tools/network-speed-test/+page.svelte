<script lang="ts">
  /*
   * Network Speed Test — Cloudflare's own measurement engine, on their default ladder, so the
   * numbers are comparable to speed.cloudflare.com. Runs outside any matter and stores nothing.
   *
   * Nothing begins without a press: a full run transfers a large amount of data, and the caller's
   * address reaches Cloudflare's measurement endpoints. Both facts are stated before Start.
   */
  import { onDestroy } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import MetricTile from "$lib/tools/speed-test/metric-tile.svelte";
  import QualityScores from "$lib/tools/speed-test/quality-scores.svelte";
  import { createSpeedTestStore } from "$lib/tools/speed-test/speed-test-engine.svelte.ts";
  import {
    formatBandwidth,
    formatMilliseconds,
  } from "$lib/tools/speed-test/speed-test-format.ts";

  const store = createSpeedTestStore();
  onDestroy(() => store.dispose());

  const results = $derived(store.results);
  const probe = $derived(store.probe);
</script>

<svelte:head><title>Network Speed Test · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Network Speed Test</Masthead.Title>
    <Masthead.Meta><span>Runs outside any matter</span></Masthead.Meta>
  </Masthead.Heading>
</Masthead.Root>

<section class="mb-24">
  {#if store.phase === "idle"}
    <p class="mb-16 text-sm text-text-muted">
      A full test can transfer around 200 MB of data. Your public address is shared with
      Cloudflare's measurement endpoints to run it. Nothing is saved.
    </p>
    <Button variant="primary" onclick={() => store.start()}>Start</Button>
  {:else if store.phase === "running"}
    <p class="mb-16 text-sm text-text-muted">Measuring…</p>
    <Button variant="secondary" onclick={() => store.pause()}>Pause</Button>
  {:else if store.phase === "paused"}
    <Button variant="primary" onclick={() => store.resume()}>Resume</Button>
  {:else}
    <Button variant="primary" onclick={() => store.restart()}>Retest</Button>
  {/if}

  {#if store.error}
    <p class="mt-16 text-sm text-status-danger-subtle-foreground">
      The measurement stopped: {store.error}. If this network filters
      speed.cloudflare.com, the test cannot run from here.
    </p>
  {/if}
</section>

<section class="mb-24 grid grid-cols-1 gap-16 sm:grid-cols-2 lg:grid-cols-3">
  <MetricTile label="Download" value={formatBandwidth(results?.getDownloadBandwidth())} />
  <MetricTile label="Upload" value={formatBandwidth(results?.getUploadBandwidth())} />
  <MetricTile label="Latency" value={formatMilliseconds(results?.getUnloadedLatency())} />
  <MetricTile label="Jitter" value={formatMilliseconds(results?.getUnloadedJitter())} />
  <MetricTile
    label="Packet loss"
    value="Unavailable"
    note="Measuring packet loss needs a TURN server; the public one Cloudflare offered is discontinued."
  />
</section>

<section class="mb-24">
  <h2
    class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Network quality score
  </h2>
  <QualityScores scores={results?.getScores()} />
</section>

<section class="mb-24">
  <h2
    class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Your connection
  </h2>
  {#if probe === null}
    <p class="text-sm text-text-muted">Not measured yet.</p>
  {:else if probe.status === "unauthenticated"}
    <p class="text-sm text-text-muted">
      You are not signed in, so the round trip to Magna Carta was not measured. This says nothing
      about your connection — the measurements above still describe it.
    </p>
  {:else if probe.status === "forbidden"}
    <p class="text-sm text-text-muted">
      Your account does not carry permission to run this check, so the round trip to Magna Carta
      was not measured. Your connection is unaffected.
    </p>
  {:else if probe.status === "unreachable"}
    <p class="text-sm text-text-muted">
      Magna Carta could not be reached from this network. The measurements above, if present,
      still describe your internet connection.
    </p>
  {:else if probe.facts !== null}
    <dl class="grid grid-cols-1 gap-16 text-sm sm:grid-cols-2">
      <div><dt class="text-text-muted">Public address</dt><dd>{probe.facts.ip}</dd></div>
      <div>
        <dt class="text-text-muted">Network</dt>
        <dd>{probe.facts.asOrganization} (AS{probe.facts.asn})</dd>
      </div>
      <div><dt class="text-text-muted">Served from</dt><dd>{probe.facts.colo}</dd></div>
      <div>
        <dt class="text-text-muted">Round trip to Magna Carta</dt>
        <dd>{formatMilliseconds(probe.medianRoundTripMs ?? undefined)}</dd>
      </div>
    </dl>
    <p class="mt-16 text-xs text-text-muted">
      Measured as a real authenticated request, median of {probe.successfulSamples} samples. A
      healthy round trip here alongside poor bandwidth above means the connection, not the
      platform, is the constraint.
    </p>
  {/if}
</section>
