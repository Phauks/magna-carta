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
  import Progress from "@magna-carta/design-system/progress";
  import { bandwidthStats } from "$lib/tools/speed-test/bandwidth-stats.ts";
  import BandwidthChart from "$lib/tools/speed-test/bandwidth-chart.svelte";
  import InfoPopover from "$lib/tools/speed-test/info-popover.svelte";
  import LatencyChart from "$lib/tools/speed-test/latency-chart.svelte";
  import MetricTile from "$lib/tools/speed-test/metric-tile.svelte";
  import QualityScores from "$lib/tools/speed-test/quality-scores.svelte";
  import { formatBytes } from "$lib/tools/speed-test/run-progress.ts";
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
  const downloadStats = $derived(bandwidthStats(results?.getDownloadBandwidthPoints() ?? []));
  const uploadStats = $derived(bandwidthStats(results?.getUploadBandwidthPoints() ?? []));
  // A truthful progress fraction: `stepIndex` is the monotonic index of the current step within
  // the ladder the engine was actually built with, never an estimate of time or bytes remaining.
  const progressPercent = $derived(
    store.stepIndex === null ? 0 : ((store.stepIndex + 1) / store.stepCount) * 100,
  );

  // Always returns four rows — with em dashes before a run has data — so the tile occupies its
  // final height from the moment the page loads rather than growing when a run finishes.
  function statRows(stats: ReturnType<typeof bandwidthStats>) {
    if (stats === null) {
      return [
        { label: "Median", value: "—" },
        { label: "95th", value: "—" },
        { label: "Peak", value: "—" },
        { label: "Samples", value: "—" },
      ];
    }
    return [
      { label: "Median", value: formatBandwidth(stats.median) },
      { label: "95th", value: formatBandwidth(stats.p95) },
      { label: "Peak", value: formatBandwidth(stats.peak) },
      { label: "Samples", value: String(stats.samples) },
    ];
  }
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
        {#if store.bytesUsed > 0}
          <Masthead.MetaSeparator />
          <span>{formatBytes(store.bytesUsed)} transferred</span>
        {/if}
      {/if}
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    {#if store.phase === "idle"}
      <Button variant="primary" onclick={() => store.start()}>Start</Button>
    {:else if store.phase === "running"}
      <div class="flex items-center gap-8">
        <span class="text-sm text-text-muted">
          {store.currentPhase ?? "Starting"}
          {#if store.stepIndex !== null}
            · step {store.stepIndex + 1} of {store.stepCount}
          {/if}
          {#if store.bytesUsed > 0}
            · {formatBytes(store.bytesUsed)} used
          {/if}
        </span>
        <Progress value={progressPercent} class="w-96" aria-label="Test progress" />
        <Button variant="secondary" onclick={() => store.pause()}>Pause</Button>
        <Button variant="ghost" onclick={() => store.cancel()}>Cancel</Button>
      </div>
    {:else if store.phase === "paused"}
      <Button variant="primary" onclick={() => store.resume()}>Resume</Button>
      <Button variant="secondary" onclick={() => store.restart()}>Restart</Button>
    {:else}
      <Button variant="primary" onclick={() => store.restart()}>Retest</Button>
    {/if}
  </Masthead.Actions>
</Masthead.Root>

<section class="mb-24">
  <p class="mb-16 text-sm text-text-muted">
    A full test can transfer around 200 MB of data. Your public address is shared with
    Cloudflare's measurement endpoints to run it. Nothing is saved.
  </p>

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
    stats={statRows(downloadStats)}
  >
    {#snippet info()}
      <InfoPopover label="What does Download mean?">
        <p>
          The headline figure is the 90th percentile of this run's samples, not an average — nine
          measurements in ten were at least this fast. The median, 95th percentile and peak below
          show how consistent the connection was.
        </p>
      </InfoPopover>
    {/snippet}
  </MetricTile>
  <MetricTile
    size="large"
    label="Upload"
    value={formatBandwidth(results?.getUploadBandwidth())}
    stats={statRows(uploadStats)}
  >
    {#snippet info()}
      <InfoPopover label="What does Upload mean?">
        <p>
          The headline figure is the 90th percentile of this run's samples, not an average — nine
          measurements in ten were at least this fast. The median, 95th percentile and peak below
          show how consistent the connection was.
        </p>
      </InfoPopover>
    {/snippet}
  </MetricTile>
</section>

<section class="mb-24 grid grid-cols-1 gap-16 sm:grid-cols-3">
  <MetricTile label="Latency" value={formatMilliseconds(results?.getUnloadedLatency())}>
    {#snippet info()}
      <InfoPopover label="What does Latency mean?">
        <p>The median of this run's latency samples, measured while the connection was idle.</p>
      </InfoPopover>
    {/snippet}
  </MetricTile>
  <MetricTile label="Jitter" value={formatMilliseconds(results?.getUnloadedJitter())} />
  {#if store.turn?.available}
    <MetricTile
      label="Packet loss"
      value={formatRatio(results?.getPacketLoss())}
      note="Measured through a TURN relay."
    />
  {:else if store.turn}
    <MetricTile label="Packet loss" value="Unavailable" note={turnUnavailableNote(store.turn.reason)} />
  {:else}
    <MetricTile label="Packet loss" value="—" note="Measured when a test runs." />
  {/if}
</section>

<section class="mb-24">
  <h2
    class="mb-16 flex items-center gap-4 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    <span>Network quality score</span>
    <InfoPopover label="What do these scores mean?">
      <p>
        Cloudflare's Aggregated Internet Measurement scores this connection for video streaming,
        online gaming, and video calls, rating each bad, poor, average, good, or great.
      </p>
      <p class="mt-8">
        Each measurement earns points against published thresholds — for example, unloaded latency
        scores 20 points under 10ms and nothing over 100ms. Streaming weighs download speed,
        latency, packet loss, and how much latency rises under load; gaming weighs packet loss,
        latency, and that same rise; video calls add jitter. The points behind each rating are
        published; the exact cutoffs between the five ratings are not.
      </p>
      <p class="mt-8">
        Packet loss is not measured here, and it feeds all three ratings — online gaming draws on
        only three measurements, one of them packet loss. Read these ratings as incomplete.
      </p>
      <a
        href="https://blog.cloudflare.com/aim-database-for-internet-quality/"
        target="_blank"
        rel="noreferrer noopener"
        class="mt-8 block underline"
      >
        How Cloudflare scores a connection
      </a>
    </InfoPopover>
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

<section class="mb-24">
  <h2
    class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Latency measurements
  </h2>
  <div class="grid grid-cols-1 gap-16 lg:grid-cols-3">
    <LatencyChart title="Idle" points={results?.getUnloadedLatencyPoints() ?? []} />
    <LatencyChart title="During download" points={results?.getDownLoadedLatencyPoints() ?? []} />
    <LatencyChart title="During upload" points={results?.getUpLoadedLatencyPoints() ?? []} />
  </div>
</section>

<section class="mb-24">
  <h2
    class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Download measurements
  </h2>
  <BandwidthChart title="Download" points={results?.getDownloadBandwidthPoints() ?? []} />
</section>

<section class="mb-24">
  <h2
    class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Upload measurements
  </h2>
  <BandwidthChart title="Upload" points={results?.getUploadBandwidthPoints() ?? []} />
</section>
