<script lang="ts">
  /*
   * Network Speed Test — Cloudflare's own measurement engine, on their ladder, so the numbers stay
   * comparable to speed.cloudflare.com. The packet-loss step only joins the ladder when the relay
   * credentials behind it can actually be had (asked before the engine is built — see
   * speed-test-engine.svelte.ts); otherwise the tile says why. Runs outside any matter and stores
   * nothing.
   *
   * Nothing begins without a press: a full run transfers a large amount of data, and the caller's
   * address reaches Cloudflare's measurement endpoints. Both facts are stated before Start. Run
   * controls live in the masthead so starting a run never reflows the page body.
   */
  import { onDestroy } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import * as Masthead from "@magna-carta/design-system/masthead";
  import MetricTile from "$lib/tools/speed-test/metric-tile.svelte";
  import QualityScores from "$lib/tools/speed-test/quality-scores.svelte";
  import ServerPanel from "$lib/tools/speed-test/server-panel.svelte";
  import { createSpeedTestStore } from "$lib/tools/speed-test/speed-test-engine.svelte.ts";
  import {
    formatBandwidth,
    formatMilliseconds,
    formatRatio,
  } from "$lib/tools/speed-test/speed-test-format.ts";
  import { turnUnavailableNote } from "$lib/tools/speed-test/turn-capability.ts";

  const store = createSpeedTestStore();
  onDestroy(() => store.dispose());

  const results = $derived(store.results);
</script>

<svelte:head><title>Network Speed Test · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Network Speed Test</Masthead.Title>
    <Masthead.Meta>
      <span>Runs outside any matter</span>
      {#if store.finishedAt}
        <Masthead.MetaSeparator />
        <span>
          Run at {store.finishedAt.toLocaleTimeString()} on {store.finishedAt.toLocaleDateString()}
        </span>
      {/if}
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    {#if store.phase === "idle"}
      <Button variant="primary" onclick={() => store.start()}>Start</Button>
    {:else if store.phase === "running"}
      <span class="mr-8 text-sm text-text-muted">Measuring…</span>
      <Button variant="secondary" onclick={() => store.pause()}>Pause</Button>
    {:else if store.phase === "paused"}
      <Button variant="primary" onclick={() => store.resume()}>Resume</Button>
    {:else}
      <Button variant="primary" onclick={() => store.restart()}>Retest</Button>
    {/if}
  </Masthead.Actions>
</Masthead.Root>

<section class="mb-24">
  {#if store.phase === "idle"}
    <p class="mb-16 text-sm text-text-muted">
      A full test can transfer around 200 MB of data. Your public address is shared with
      Cloudflare's measurement endpoints to run it. Nothing is saved.
    </p>
  {/if}

  {#if store.error}
    <p class="mt-16 text-sm text-status-danger-subtle-foreground">
      The measurement stopped: {store.error}
    </p>
  {/if}
</section>

<section class="mb-24 grid grid-cols-1 gap-16 sm:grid-cols-2">
  <MetricTile
    size="large"
    label="Download"
    value={formatBandwidth(results?.getDownloadBandwidth())}
  />
  <MetricTile size="large" label="Upload" value={formatBandwidth(results?.getUploadBandwidth())} />
</section>

<section class="mb-24 grid grid-cols-1 gap-16 sm:grid-cols-3">
  <MetricTile label="Latency" value={formatMilliseconds(results?.getUnloadedLatency())} />
  <MetricTile label="Jitter" value={formatMilliseconds(results?.getUnloadedJitter())} />
  {#if store.turn?.available}
    <MetricTile label="Packet loss" value={formatRatio(results?.getPacketLoss())} />
  {:else if store.turn}
    <MetricTile label="Packet loss" value="Unavailable" note={turnUnavailableNote(store.turn.reason)} />
  {:else}
    <MetricTile label="Packet loss" value="—" note="Measured when a test runs." />
  {/if}
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
  <ServerPanel meta={store.meta} probe={store.probe} />
</section>
