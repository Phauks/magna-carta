<script lang="ts">
  /*
   * The Resources module — a live, honest browser-resource monitor for the developer console.
   *
   * ONLY-WHILE-OPEN CONTRACT: every sampler here (intervals, PerformanceObservers, the frame
   * loop, the presence channel) starts in `$effect` on mount and is torn down on unmount. The
   * console is a popover whose content unmounts on close, so nothing in this module costs
   * anything while the console is shut — no background sampling, ever (the no-work-off-the-
   * visible-path rule).
   *
   * HONESTY RULES, per meter:
   * - Memory is Chrome's non-standard `performance.memory` (guarded; other browsers say so
   *   plainly), upgraded to `measureUserAgentSpecificMemory()` under cross-origin isolation.
   *   Values are approximations — the browser quantizes and delays them by design.
   * - Browsers expose NO CPU percentage; event-loop lag, long tasks, and frame pacing are the
   *   honest stand-in, and the panel says so.
   * - Network is RECENT COMPLETED requests from the resource performance timeline, not
   *   requests in flight: global in-flight tracking would need fetch/XHR instrumentation we
   *   deliberately do not add for a diagnostics panel.
   * - Active Work is a seam: the account's running streams (editing sessions, scans,
   *   conversions, queue jobs) need a platform activity-inventory endpoint that does not exist
   *   yet — the section lights up when it ships.
   */
  import Badge from "@magna-carta/design-system/badge";

  const SAMPLE_WINDOW_MILLISECONDS = 60_000;
  const LAG_INTERVAL_MILLISECONDS = 500;
  const SLOW_SAMPLE_INTERVAL_MILLISECONDS = 10_000;
  const PRESENCE_INTERVAL_MILLISECONDS = 5_000;

  // ─── Memory ───────────────────────────────────────────────────────────────────────────────
  interface ChromeMemoryInfo {
    readonly usedJSHeapSize: number;
    readonly jsHeapSizeLimit: number;
  }
  interface MemoryMeasurement {
    readonly bytes: number;
  }

  let memoryUsedBytes = $state<number | null>(null);
  let memoryLimitBytes = $state<number | null>(null);
  let memorySource = $state<"agent" | "heap" | "unavailable">("unavailable");

  function sampleMemory(): void {
    // Prefer the standardized measurement when the page is cross-origin isolated — it covers
    // more than the JS heap. It is async and rate-limited by the browser, hence the slow tick.
    const measure = (
      performance as { measureUserAgentSpecificMemory?: () => Promise<MemoryMeasurement> }
    ).measureUserAgentSpecificMemory;
    if (crossOriginIsolated && typeof measure === "function") {
      void measure.call(performance).then((measurement) => {
        memoryUsedBytes = measurement.bytes;
        memoryLimitBytes = null;
        memorySource = "agent";
      });
      return;
    }
    const chromeMemory = (performance as { memory?: ChromeMemoryInfo }).memory;
    if (chromeMemory !== undefined) {
      memoryUsedBytes = chromeMemory.usedJSHeapSize;
      memoryLimitBytes = chromeMemory.jsHeapSizeLimit;
      memorySource = "heap";
      return;
    }
    memorySource = "unavailable";
  }

  // ─── Responsiveness ───────────────────────────────────────────────────────────────────────
  let eventLoopLagMilliseconds = $state(0);
  let worstLagMilliseconds = $state(0);
  let longTaskTimestamps: number[] = [];
  let longTaskDurations: number[] = [];
  let longTaskCount = $state(0);
  let longTaskTotalMilliseconds = $state(0);
  let frameIntervalMilliseconds = $state<number | null>(null);

  function pruneLongTasks(): void {
    const cutoff = performance.now() - SAMPLE_WINDOW_MILLISECONDS;
    while (longTaskTimestamps.length > 0 && (longTaskTimestamps[0] as number) < cutoff) {
      longTaskTimestamps.shift();
      longTaskDurations.shift();
    }
    longTaskCount = longTaskTimestamps.length;
    longTaskTotalMilliseconds = longTaskDurations.reduce((sum, duration) => sum + duration, 0);
  }

  // ─── Storage ──────────────────────────────────────────────────────────────────────────────
  let storageUsedBytes = $state<number | null>(null);
  let storageQuotaBytes = $state<number | null>(null);

  function sampleStorage(): void {
    if (!("storage" in navigator) || typeof navigator.storage.estimate !== "function") return;
    void navigator.storage.estimate().then((estimate) => {
      storageUsedBytes = estimate.usage ?? null;
      storageQuotaBytes = estimate.quota ?? null;
    });
  }

  // ─── Network (recent completed requests) ──────────────────────────────────────────────────
  let resourceTimestamps: number[] = [];
  let resourceBytes: number[] = [];
  let recentRequestCount = $state(0);
  let recentTransferBytes = $state(0);

  function pruneResources(): void {
    const cutoff = performance.now() - SAMPLE_WINDOW_MILLISECONDS;
    while (resourceTimestamps.length > 0 && (resourceTimestamps[0] as number) < cutoff) {
      resourceTimestamps.shift();
      resourceBytes.shift();
    }
    recentRequestCount = resourceTimestamps.length;
    recentTransferBytes = resourceBytes.reduce((sum, bytes) => sum + bytes, 0);
  }

  // ─── Open tabs (presence ping over BroadcastChannel, the cross-tab conventions' sibling) ──
  const tabIdentity = crypto.randomUUID();
  const tabLastSeen = new Map<string, number>();
  let openTabCount = $state(1);

  function countTabs(): void {
    const cutoff = Date.now() - PRESENCE_INTERVAL_MILLISECONDS * 2.5;
    for (const [id, seen] of tabLastSeen) {
      if (seen < cutoff) tabLastSeen.delete(id);
    }
    openTabCount = tabLastSeen.size + 1; // plus this tab
  }

  // ─── Samplers: mount-scoped, torn down on unmount (the only-while-open contract). ─────────
  $effect(() => {
    sampleMemory();
    sampleStorage();

    // Event-loop lag: how late a timer fires versus when it was due — drift IS the lag.
    let expected = performance.now() + LAG_INTERVAL_MILLISECONDS;
    const lagInterval = setInterval(() => {
      const now = performance.now();
      const lag = Math.max(0, now - expected);
      eventLoopLagMilliseconds = lag;
      worstLagMilliseconds = Math.max(worstLagMilliseconds, lag);
      expected = now + LAG_INTERVAL_MILLISECONDS;
      pruneLongTasks();
      pruneResources();
      countTabs();
    }, LAG_INTERVAL_MILLISECONDS);

    const slowInterval = setInterval(() => {
      sampleMemory();
      sampleStorage();
    }, SLOW_SAMPLE_INTERVAL_MILLISECONDS);

    // Long tasks (>50ms main-thread blocks) — not supported everywhere; absence just leaves
    // the counter honest at zero for the window.
    let longTaskObserver: PerformanceObserver | null = null;
    try {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskTimestamps.push(entry.startTime);
          longTaskDurations.push(entry.duration);
        }
        pruneLongTasks();
      });
      longTaskObserver.observe({ type: "longtask", buffered: true });
    } catch {
      longTaskObserver = null;
    }

    let resourceObserver: PerformanceObserver | null = null;
    try {
      resourceObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const resource = entry as PerformanceResourceTiming;
          resourceTimestamps.push(resource.responseEnd);
          resourceBytes.push(resource.transferSize);
        }
        pruneResources();
      });
      resourceObserver.observe({ type: "resource", buffered: true });
    } catch {
      resourceObserver = null;
    }

    // Frame pacing: average interval across the frames of the last second.
    let frameHandle = 0;
    let lastFrameAt = performance.now();
    const frameIntervals: number[] = [];
    const onFrame = (now: DOMHighResTimeStamp): void => {
      frameIntervals.push(now - lastFrameAt);
      lastFrameAt = now;
      if (frameIntervals.length > 60) frameIntervals.shift();
      frameIntervalMilliseconds =
        frameIntervals.reduce((sum, value) => sum + value, 0) / frameIntervals.length;
      frameHandle = requestAnimationFrame(onFrame);
    };
    frameHandle = requestAnimationFrame(onFrame);

    // Presence: ping on an interval; every tab that answers within the window counts as open.
    let channel: BroadcastChannel | null = null;
    let presenceInterval: ReturnType<typeof setInterval> | null = null;
    try {
      channel = new BroadcastChannel("magna-carta.tab-presence");
      channel.onmessage = (event: MessageEvent<{ type: string; id: string }>) => {
        if (event.data.id === tabIdentity) return;
        tabLastSeen.set(event.data.id, Date.now());
        if (event.data.type === "ping") {
          channel?.postMessage({ type: "pong", id: tabIdentity });
        }
        countTabs();
      };
      channel.postMessage({ type: "ping", id: tabIdentity });
      presenceInterval = setInterval(() => {
        channel?.postMessage({ type: "ping", id: tabIdentity });
      }, PRESENCE_INTERVAL_MILLISECONDS);
    } catch {
      channel = null;
    }

    return () => {
      clearInterval(lagInterval);
      clearInterval(slowInterval);
      if (presenceInterval !== null) clearInterval(presenceInterval);
      longTaskObserver?.disconnect();
      resourceObserver?.disconnect();
      cancelAnimationFrame(frameHandle);
      channel?.close();
    };
  });

  // ─── Formatting (ledger voice: tabular figures, honest units) ─────────────────────────────
  function formatBytes(bytes: number): string {
    if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
    if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${Math.round(bytes)} B`;
  }

  function formatMilliseconds(milliseconds: number): string {
    return `${milliseconds.toFixed(1)} ms`;
  }
</script>

{#snippet meterRow(label: string, value: string)}
  <div class="flex items-baseline justify-between gap-16">
    <dt class="text-sm text-text-muted">{label}</dt>
    <dd class="text-sm tabular-nums">{value}</dd>
  </div>
{/snippet}

<div class="flex flex-col gap-12">
  <div class="flex flex-col gap-8">
    <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Memory
    </p>
    <dl class="flex flex-col gap-4">
      {#if memorySource === "unavailable"}
        {@render meterRow("JavaScript memory", "Unavailable in this browser")}
      {:else if memorySource === "agent"}
        {@render meterRow("Page memory", `≈ ${formatBytes(memoryUsedBytes ?? 0)}`)}
      {:else}
        {@render meterRow("JavaScript heap", `≈ ${formatBytes(memoryUsedBytes ?? 0)}`)}
        {#if memoryLimitBytes !== null}
          {@render meterRow("Heap ceiling", `≈ ${formatBytes(memoryLimitBytes)}`)}
        {/if}
      {/if}
    </dl>
    <p class="text-xs text-text-muted">Approximate — the browser quantizes and delays these.</p>
  </div>

  <div class="flex flex-col gap-8">
    <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Responsiveness
    </p>
    <dl class="flex flex-col gap-4">
      {@render meterRow("Event-loop lag", formatMilliseconds(eventLoopLagMilliseconds))}
      {@render meterRow("Worst lag this session", formatMilliseconds(worstLagMilliseconds))}
      {@render meterRow("Long tasks (last 60s)", String(longTaskCount))}
      {@render meterRow("Blocked time (last 60s)", formatMilliseconds(longTaskTotalMilliseconds))}
      {#if frameIntervalMilliseconds !== null}
        {@render meterRow("Frame interval", formatMilliseconds(frameIntervalMilliseconds))}
      {/if}
    </dl>
    <p class="text-xs text-text-muted">
      Browsers expose no CPU percentage — lag and long tasks are the honest stand-in.
    </p>
  </div>

  <div class="flex flex-col gap-8">
    <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Storage
    </p>
    <dl class="flex flex-col gap-4">
      {#if storageUsedBytes !== null && storageQuotaBytes !== null && storageQuotaBytes > 0}
        {@render meterRow(
          "Origin storage",
          `${formatBytes(storageUsedBytes)} of ${formatBytes(storageQuotaBytes)} · ${((storageUsedBytes / storageQuotaBytes) * 100).toFixed(1)}%`,
        )}
      {:else}
        {@render meterRow("Origin storage", "Unavailable in this browser")}
      {/if}
    </dl>
  </div>

  <div class="flex flex-col gap-8">
    <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Network
    </p>
    <dl class="flex flex-col gap-4">
      {@render meterRow("Requests (last 60s)", String(recentRequestCount))}
      {@render meterRow("Transferred (last 60s)", formatBytes(recentTransferBytes))}
    </dl>
    <p class="text-xs text-text-muted">
      Recent completed requests — not in flight; cross-origin sizes may report as zero.
    </p>
  </div>

  <div class="flex flex-col gap-8">
    <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
      Open Tabs
    </p>
    <dl class="flex flex-col gap-4">
      {@render meterRow("Magna Carta tabs", String(openTabCount))}
    </dl>
  </div>

  <div class="flex flex-col gap-8">
    <div class="flex items-center gap-8">
      <p class="text-xs text-text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
        Active Work
      </p>
      <Badge variant="neutral">Soon</Badge>
    </div>
    <p class="text-xs text-text-muted">
      Editing sessions, scans, conversions, and queue jobs for this account appear here when the
      platform's activity inventory ships.
    </p>
  </div>
</div>
