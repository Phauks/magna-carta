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
  import { onDestroy, onMount } from "svelte";
  import { opensBeside } from "$lib/navigation/open-beside.ts";
  import Button from "@magna-carta/design-system/button";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import ScreenHeader from "$lib/screen/screen-header.svelte";
  import { bandwidthStats } from "$lib/tools/speed-test/bandwidth-stats.ts";
  import BandwidthSparkline from "$lib/tools/speed-test/bandwidth-sparkline.svelte";
  import InfoHint from "$lib/tools/speed-test/info-hint.svelte";
  import LatencyChart from "$lib/tools/speed-test/latency-chart.svelte";
  import MetricTile from "$lib/tools/speed-test/metric-tile.svelte";
  import QualityScores from "$lib/tools/speed-test/quality-scores.svelte";
  import { bytesInDirection, formatBytes } from "$lib/tools/speed-test/run-progress.ts";
  import RunProgressPanel from "$lib/tools/speed-test/run-progress-panel.svelte";
  import ServerPanel from "$lib/tools/speed-test/server-panel.svelte";
  import { createSpeedTestStore } from "$lib/tools/speed-test/speed-test-engine.svelte.ts";
  import SpeedTestMenu from "$lib/tools/speed-test/speed-test-menu.svelte";
  import {
    renderReport,
    reportFilename,
    type ReportInput,
  } from "$lib/tools/speed-test/speed-test-report.ts";
  import {
    preferences,
    setLowData,
    setAutoStart,
  } from "$lib/tools/speed-test/speed-test-preferences.svelte.ts";
  import SteadyLabel from "$lib/tools/speed-test/steady-label.svelte";
  import {
    formatBandwidth,
    formatMilliseconds,
    formatRatio,
  } from "$lib/tools/speed-test/speed-test-format.ts";
  import { ABSENT_MARKER } from "$lib/tools/speed-test/absence.ts";
  import { turnUnavailableNote } from "$lib/tools/speed-test/turn-capability.ts";
  import { formatInstantDate, formatTimeOfDay } from "@magna-carta/design-system/formatters";

  const store = createSpeedTestStore();
  onDestroy(() => store.dispose());

  // Auto-start is opt-in and off by default. It only ever fires on a fresh page open with no run in
  // progress — never on a preference change, never after a cancel: a person who cancelled a run did
  // not ask for another. onMount runs client-only, so a prerender never spends bandwidth.
  onMount(() => {
    if (preferences().autoStart && store.phase === "idle") store.start();
  });

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
   * Every word either control button can show. BOTH buttons reserve the width of the widest of
   * them, so the pair is symmetric and neither resizes when its word changes. Reserving each slot
   * against only its own words would still leave them unequal — "Resume" is shorter than "Restart".
   *
   * "Download report" is deliberately absent: it is not a run control, it lives in the overflow
   * menu, and reserving its width here would make both buttons far wider than they need to be.
   */
  const CONTROL_LABELS = ["Start", "Pause", "Resume", "Retest", "Cancel", "Restart"] as const;

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

  // Only running and paused have a real secondary action; idle, finished, and failed keep the button
  // present but disabled, so the control pair is a constant fixture rather than one that appears the
  // moment a run starts and collapses to a single button the moment it ends.
  const secondaryEnabled = $derived(store.phase === "running" || store.phase === "paused");

  const secondaryLabel = $derived(store.phase === "paused" ? "Restart" : "Cancel");

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
    const transferred = {
      label: "Transferred",
      value: spent > 0 ? formatBytes(spent) : ABSENT_MARKER,
    };
    if (stats === null) {
      return [
        { label: "Median", value: ABSENT_MARKER },
        { label: "95th", value: ABSENT_MARKER },
        { label: "Peak", value: ABSENT_MARKER },
        { label: "Samples", value: ABSENT_MARKER },
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

  /*
   * Assemble the finished run into a plain-text file and hand it to the operating system: a Blob, a
   * one-shot object URL, a synthetic click, then an immediate revoke. Nothing is persisted by us, no
   * server round trip, no matter attachment — the file is the run in front of you, and the object URL
   * is revoked at once because a leaked one pins the blob for the page's whole life. Gated on a
   * finished run (the menu item is disabled otherwise), so the early return only guards a race.
   */
  function downloadReport(): void {
    const finishedAt = store.finishedAt;
    if (store.phase !== "finished" || !finishedAt) return;

    const runResults = store.results;
    const turn = store.turn;
    const outcome = store.probe;
    const meta = store.meta;

    // The library types scores as Record<string, ExperienceScore>; the report wants the three
    // use-cases' classification words. Absent (an unfinished or degraded run) stays undefined so the
    // report can say so rather than print a blank rating.
    const rawScores = runResults?.getScores();
    const scores =
      rawScores && rawScores.streaming && rawScores.gaming && rawScores.rtc
        ? {
            streaming: rawScores.streaming.classificationName,
            gaming: rawScores.gaming.classificationName,
            rtc: rawScores.rtc.classificationName,
          }
        : undefined;

    // Packet loss is a real reading only when the relay was reachable AND a sample landed. The three
    // not-measured reasons are distinct: relay reachable but no sample, relay unavailable (with its
    // specific cause), and no probe at all — never conflate the first with "sign in", which would
    // tell a signed-in user to sign in and contradict the on-screen tile.
    const lossRatio = turn?.available ? runResults?.getPacketLoss() : undefined;
    let packetLoss: ReportInput["packetLoss"];
    if (turn?.available && typeof lossRatio === "number") {
      packetLoss = { measured: true, ratio: lossRatio };
    } else if (turn?.available) {
      packetLoss = {
        measured: false,
        reason: "The relay was reachable, but no packet-loss sample completed.",
      };
    } else if (turn) {
      packetLoss = { measured: false, reason: turnUnavailableNote(turn.reason) };
    } else {
      packetLoss = { measured: false, reason: "Sign in to measure packet loss." };
    }

    // The round trip mirrors what the connection panel shows for this probe status. A reachable probe
    // always carries a median; every other status is not-measured with the panel's reason.
    let roundTrip: ReportInput["roundTrip"];
    if (outcome?.status === "reachable" && outcome.medianRoundTripMs !== null) {
      roundTrip = { reachable: true, medianMs: outcome.medianRoundTripMs };
    } else {
      let note: string;
      switch (outcome?.status) {
        case "unauthenticated":
          note = "You are not signed in.";
          break;
        case "forbidden":
          note = "Your account does not carry permission to run this check.";
          break;
        case "unreachable":
          note = "Magna Carta could not be reached from this network.";
          break;
        default:
          note = "The round trip to Magna Carta was not measured.";
      }
      roundTrip = { reachable: false, note };
    }

    const input: ReportInput = {
      finishedAt,
      downloadBps: runResults?.getDownloadBandwidth(),
      uploadBps: runResults?.getUploadBandwidth(),
      latencyMs: runResults?.getUnloadedLatency(),
      jitterMs: runResults?.getUnloadedJitter(),
      packetLoss,
      scores,
      server: meta
        ? {
            clientIp: meta.clientIp,
            asOrganization: meta.asOrganization,
            asn: meta.asn,
            coloCity: meta.coloCity,
            coloIata: meta.coloIata,
          }
        : null,
      roundTrip,
      bytesDown: bytesInDirection(downloadPoints),
      bytesUp: bytesInDirection(uploadPoints),
      lowData: store.lowData,
    };

    const url = URL.createObjectURL(
      new Blob([renderReport(input)], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportFilename(finishedAt);
    anchor.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>Network Speed Test · Magna Carta</title></svelte:head>

<ScreenHeader
  title="Network Speed Test"
  class="mb-24"
>
  {#snippet meta()}
    {#if store.finishedAt}
      <span>
        Run at {formatTimeOfDay(store.finishedAt, { precision: "second" })} on {formatInstantDate(
          store.finishedAt,
        )}
      </span>
    {:else}
      <span>&nbsp;</span>
    {/if}
  {/snippet}
  {#snippet actions()}
    <RunProgressPanel
      phaseText={phaseText}
      stepIndex={displayStepIndex}
      stepCount={store.stepCount}
      bytesUsed={store.bytesUsed}
    />
    <Button variant="primary" onclick={primaryAction}>
      <SteadyLabel labels={CONTROL_LABELS} current={primaryLabel} />
    </Button>

    <!-- A bordered ghost, the same outline treatment as the overflow trigger beside it, so the
         button reads as a real control in every phase. `disabled:bg-transparent` drops the default
         disabled fill: a grey blob reads as absent, but a transparent panel with a visible border
         and muted label reads as a present-but-inactive button. -->
    <Button
      variant="ghost"
      class="border border-border-default disabled:bg-transparent disabled:opacity-60"
      disabled={!secondaryEnabled}
      onclick={secondaryAction}
    >
      <SteadyLabel labels={CONTROL_LABELS} current={secondaryLabel} />
    </Button>

    <SpeedTestMenu
      lowData={preferences().lowData}
      autoStart={preferences().autoStart}
      disabled={store.phase === "running" || store.phase === "paused"}
      canDownloadReport={store.phase === "finished"}
      onLowDataChange={setLowData}
      onAutoStartChange={setAutoStart}
      onDownloadReport={downloadReport}
    />
  {/snippet}
</ScreenHeader>

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
      <InfoHint label="What does Download mean?">
        <p>
          The main figure is the 90th percentile, not an average: nine in ten measurements were at least this fast. The median, 95th percentile and peak below show how steady the connection was.
        </p>
      </InfoHint>
    {/snippet}
    {#snippet chart()}
      <BandwidthSparkline label="Download" points={downloadPoints} />
    {/snippet}
  </MetricTile>
  <MetricTile
    size="large"
    label="Upload"
    value={formatBandwidth(results?.getUploadBandwidth())}
    stats={statRows(uploadStats, uploadPoints)}
  >
    {#snippet info()}
      <InfoHint label="What does Upload mean?">
        <p>
          The main figure is the 90th percentile, not an average: nine in ten measurements were at least this fast. The median, 95th percentile and peak below show how steady the connection was.
        </p>
      </InfoHint>
    {/snippet}
    {#snippet chart()}
      <BandwidthSparkline label="Upload" points={uploadPoints} />
    {/snippet}
  </MetricTile>
</section>

<section class="mb-24 grid grid-cols-1 gap-16 sm:grid-cols-3">
  <MetricTile label="Latency" value={formatMilliseconds(results?.getUnloadedLatency())}>
    {#snippet info()}
      <InfoHint label="What does Latency mean?">
        <p>The median of this run's latency samples, measured while the connection was idle.</p>
      </InfoHint>
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
    <MetricTile label="Packet loss" value={ABSENT_MARKER} />
  {/if}
</section>

<section class="mb-24">
  <FieldLabel as="h2" class="mb-16 flex items-center gap-4 border-b border-border-strong pb-8"
  >
    <span>Network quality score</span>
    <InfoHint label="What do these scores mean?">
      <p>
        Cloudflare's Aggregated Internet Measurement rates this connection for video streaming, online gaming and video calls, from bad to great.
      </p>
      <p class="mt-8">
        Each rating is based on published thresholds for download speed, latency, packet loss, jitter and how much latency rises under load. The exact cutoffs between ratings aren't published.
      </p>
      <p class="mt-8">
        Packet loss isn't measured here, and all three ratings use it, so read them as incomplete.
      </p>
    </InfoHint>
    <a
      href="https://blog.cloudflare.com/aim-database-for-internet-quality/"
      {...opensBeside("external")}
      class="underline"
    >
      Learn more
    </a>
  </FieldLabel>
  <!-- The engine rescores on every sample, so a rating shown mid-run climbs and falls before the
       measurements it weighs even exist. A verdict is worth showing only once it is final. -->
  <QualityScores scores={store.phase === "finished" ? results?.getScores() : undefined} />
</section>

<section class="mb-24">
  <FieldLabel as="h2" class="mb-16 border-b border-border-strong pb-8"
  >
    Your connection
  </FieldLabel>
  <ServerPanel meta={store.meta} probe={store.probe} />
</section>

<section class="mb-24">
  <FieldLabel as="h2" class="mb-16 border-b border-border-strong pb-8"
  >
    Latency measurements
  </FieldLabel>
  <div class="grid grid-cols-1 gap-16 lg:grid-cols-3">
    <LatencyChart title="Idle" points={results?.getUnloadedLatencyPoints() ?? []} />
    <LatencyChart title="During download" points={results?.getDownLoadedLatencyPoints() ?? []} />
    <LatencyChart title="During upload" points={results?.getUpLoadedLatencyPoints() ?? []} />
  </div>
</section>

<footer class="mt-40 border-t border-border-default pt-16 text-xs text-text-muted">
  A full test uses about 200 MB of data; low data mode uses under 20 MB but underestimates fast connections. Your IP address is shared with Cloudflare to run the test. Nothing is saved.
</footer>
