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
  import { bandwidthStats } from "$lib/tools/speed-test/bandwidth-stats.ts";
  import BandwidthChart from "$lib/tools/speed-test/bandwidth-chart.svelte";
  import InfoPopover from "$lib/tools/speed-test/info-popover.svelte";
  import LatencyChart from "$lib/tools/speed-test/latency-chart.svelte";
  import MetricTile from "$lib/tools/speed-test/metric-tile.svelte";
  import QualityScores from "$lib/tools/speed-test/quality-scores.svelte";
  import { bytesInDirection, formatBytes } from "$lib/tools/speed-test/run-progress.ts";
  import RunProgressPanel from "$lib/tools/speed-test/run-progress-panel.svelte";
  import ServerPanel from "$lib/tools/speed-test/server-panel.svelte";
  import { createSpeedTestStore } from "$lib/tools/speed-test/speed-test-engine.svelte.ts";
  import SteadyLabel from "$lib/tools/speed-test/steady-label.svelte";
  import {
    formatBandwidth,
    formatMilliseconds,
    formatRatio,
    NOT_MEASURED_YET,
  } from "$lib/tools/speed-test/speed-test-format.ts";
  import { turnUnavailableNote } from "$lib/tools/speed-test/turn-capability.ts";

  const store = createSpeedTestStore();
  onDestroy(() => store.dispose());

  const results = $derived(store.results);
  const downloadPoints = $derived(results?.getDownloadBandwidthPoints() ?? []);
  const uploadPoints = $derived(results?.getUploadBandwidthPoints() ?? []);
  const downloadStats = $derived(bandwidthStats(downloadPoints));
  const uploadStats = $derived(bandwidthStats(uploadPoints));

  // The panel is always present; only what it can honestly say changes.
  const phaseText = $derived(
    store.phase === "idle"
      ? "Not started"
      : store.phase === "finished"
        ? "Complete"
        : store.phase === "failed"
          ? "Stopped"
          : (store.currentPhase ?? "Starting"),
  );
  // `onFinish` clears the live step counter (it has no meaning once the ladder is done), but a
  // finished run must still show its FINAL step and a full bar — not a cleared slate. Presentation
  // only: the store's own stepIndex stays null after finishing.
  const displayStepIndex = $derived(
    store.phase === "finished" && store.stepCount > 0 ? store.stepCount - 1 : store.stepIndex,
  );

  /*
   * The control region is always: panel, primary slot, secondary slot. Every word either slot could
   * ever show is listed here so SteadyLabel can reserve the widest one's width in the real font —
   * see steady-label.svelte. "Download report" is not wired to anything yet (that button lands
   * separately); it is listed so its width is already reserved and adding the real button later
   * moves nothing.
   */
  const PRIMARY_LABELS = ["Start", "Pause", "Resume", "Retest"] as const;
  const SECONDARY_LABELS = ["Cancel", "Restart", "Download report"] as const;

  const primaryLabel = $derived(
    store.phase === "idle"
      ? "Start"
      : store.phase === "running"
        ? "Pause"
        : store.phase === "paused"
          ? "Resume"
          : "Retest",
  );

  function primaryAction(): void {
    switch (store.phase) {
      case "idle":
        store.start();
        break;
      case "running":
        store.pause();
        break;
      case "paused":
        store.resume();
        break;
      case "finished":
      case "failed":
        store.restart();
        break;
    }
  }

  // Only running and paused have a real secondary action; idle, finished, and failed reserve the
  // slot's width but render it `invisible` (see the Masthead.Actions markup below) rather than a
  // disabled button naming an action it will not perform.
  const secondaryVisible = $derived(store.phase === "running" || store.phase === "paused");

  const secondaryLabel = $derived(
    store.phase === "running"
      ? "Cancel"
      : store.phase === "paused"
        ? "Restart"
        : store.phase === "finished"
          ? "Download report"
          : "Cancel",
  );

  function secondaryAction(): void {
    switch (store.phase) {
      case "running":
        store.cancel();
        break;
      case "paused":
        store.restart();
        break;
      default:
        break;
    }
  }

  // Always returns five rows — empty before a run has data — so the tile occupies its final
  // height from the moment the page loads rather than growing when a run finishes.
  function statRows(
    stats: ReturnType<typeof bandwidthStats>,
    points: ReadonlyArray<{ bytes: number }>,
  ) {
    const spent = bytesInDirection(points);
    const transferred = { label: "Transferred", value: spent > 0 ? formatBytes(spent) : "" };
    if (stats === null) {
      return [
        { label: "Median", value: "" },
        { label: "95th", value: "" },
        { label: "Peak", value: "" },
        { label: "Samples", value: "" },
        transferred,
      ];
    }
    return [
      { label: "Median", value: formatBandwidth(stats.median) },
      { label: "95th", value: formatBandwidth(stats.p95) },
      { label: "Peak", value: formatBandwidth(stats.peak) },
      { label: "Samples", value: String(stats.samples) },
      transferred,
    ];
  }
</script>

<svelte:head><title>Network Speed Test · Magna Carta</title></svelte:head>

<Masthead.Root class="mb-24">
  <Masthead.Heading>
    <Masthead.Title>Network Speed Test</Masthead.Title>
    <Masthead.Meta>
      {#if store.finishedAt}
        <span>
          Run at {store.finishedAt.toLocaleTimeString()} on {store.finishedAt.toLocaleDateString()}
        </span>
      {:else}
        <span>Not run yet</span>
      {/if}
    </Masthead.Meta>
  </Masthead.Heading>
  <Masthead.Actions>
    <RunProgressPanel
      phaseText={phaseText}
      stepIndex={displayStepIndex}
      stepCount={store.stepCount}
      bytesUsed={store.bytesUsed}
    />
    <Button variant="primary" onclick={primaryAction}>
      <SteadyLabel labels={PRIMARY_LABELS} current={primaryLabel} />
    </Button>

    <Button
      variant={store.phase === "paused" ? "secondary" : "ghost"}
      class={secondaryVisible ? undefined : "invisible"}
      tabindex={secondaryVisible ? undefined : -1}
      aria-hidden={secondaryVisible ? undefined : "true"}
      onclick={secondaryAction}
    >
      <SteadyLabel labels={SECONDARY_LABELS} current={secondaryLabel} />
    </Button>
  </Masthead.Actions>
</Masthead.Root>

{#if store.error}
  <section class="mb-24">
    <p class="text-sm text-status-danger-subtle-foreground">
      The measurement stopped: {store.error}
    </p>
  </section>
{/if}

<section class="mb-24 grid grid-cols-1 gap-16 sm:grid-cols-2">
  <MetricTile
    size="large"
    label="Download"
    value={formatBandwidth(results?.getDownloadBandwidth())}
    stats={statRows(downloadStats, downloadPoints)}
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
    stats={statRows(uploadStats, uploadPoints)}
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
    <MetricTile label="Packet loss" value="" note={NOT_MEASURED_YET} />
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
  <!-- The engine rescores on every sample, so a rating shown mid-run climbs and falls before the
       measurements it weighs even exist. A verdict is worth showing only once it is final. -->
  <QualityScores scores={store.phase === "finished" ? results?.getScores() : undefined} />
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
  <BandwidthChart title="Download" points={downloadPoints} />
</section>

<section class="mb-24">
  <h2
    class="mb-16 border-b border-border-strong pb-8 text-xs text-text-muted uppercase"
    style="letter-spacing: var(--mc-tracking-caps)"
  >
    Upload measurements
  </h2>
  <BandwidthChart title="Upload" points={uploadPoints} />
</section>

<footer class="mt-40 border-t border-border-default pt-16 text-xs text-text-muted">
  A full test can transfer around 200 MB of data. Your public address is shared with Cloudflare's
  measurement endpoints to run it. This tool runs outside any matter, and nothing is saved.
</footer>
