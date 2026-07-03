<script lang="ts">
  /*
   * The motion module — the developer console's first resident: live tuning of every animation
   * in the app through the token indirection (motion-overrides.ts writes a handful of custom
   * properties on <html>; every recipe follows). A speed multiplier, a surface picker over the
   * motion-surface registry (focus the controls on one animation, replay it where replayable),
   * an interactive cubic-bezier editor per easing token, and the copy-ready motion report — the
   * deliverable of a tuning session (motion-report.ts).
   */
  import { onMount } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import * as Select from "@magna-carta/design-system/select";
  import Separator from "@magna-carta/design-system/separator";
  import Check from "@lucide/svelte/icons/check";
  import ClipboardCopy from "@lucide/svelte/icons/clipboard-copy";
  import Play from "@lucide/svelte/icons/play";
  import EasingGraph from "../../easing-graph.svelte";
  import { buildMotionReport } from "../../motion-report.ts";
  import {
    ALL_SURFACES_ID,
    MOTION_SURFACES,
    motionSurfaceById,
  } from "../../motion-surface-registry.ts";
  import {
    applyMotionOverrides,
    clearMotionOverrides,
    clearStoredOverrides,
    DURATION_RUNGS,
    EASING_NAMES,
    formatCubicBezier,
    loadStoredOverrides,
    readMotionBaseline,
    saveStoredOverrides,
    type CubicBezierPoints,
    type EasingName,
    type MotionBaseline,
  } from "../../motion-overrides.ts";

  const SPEED_PRESETS = [0.25, 1, 3, 10] as const;

  let baseline = $state<MotionBaseline | null>(null);
  let speedMultiplier = $state(1);
  let easings = $state<Record<EasingName, CubicBezierPoints>>({
    settle: [0, 0, 1, 1],
    travel: [0, 0, 1, 1],
    standard: [0, 0, 1, 1],
    decelerate: [0, 0, 1, 1],
  });
  let activeEasing = $state<EasingName>("settle");
  let surfaceId = $state(ALL_SURFACES_ID);
  let reportCopied = $state(false);

  const surface = $derived(motionSurfaceById(surfaceId));

  onMount(() => {
    // Clear any inline overrides BEFORE reading the baseline: after a hot-module remount the
    // previous instance's overrides are still on <html>, and a baseline captured through them
    // poisons every readout and reset (the shipped tokens must be the reference, not the tuning).
    clearMotionOverrides();
    const base = readMotionBaseline();
    baseline = base;
    easings = structuredClone(base.easings);
    const stored = loadStoredOverrides();
    if (stored !== null) {
      speedMultiplier = stored.speedMultiplier;
      easings = { ...easings, ...stored.easings };
      applyMotionOverrides(base, { speedMultiplier, easings });
    }
  });

  function isPristine(): boolean {
    if (baseline === null) return true;
    return (
      speedMultiplier === 1 &&
      EASING_NAMES.every(
        (name) => formatCubicBezier(easings[name]) === formatCubicBezier(baseline!.easings[name]),
      )
    );
  }

  function apply(): void {
    if (baseline === null) return;
    if (isPristine()) {
      // Back at the shipped tokens: drop the inline layer entirely instead of pinning copies.
      clearMotionOverrides();
      clearStoredOverrides();
      return;
    }
    applyMotionOverrides(baseline, { speedMultiplier, easings });
    saveStoredOverrides({ speedMultiplier, easings });
  }

  function setSpeed(multiplier: number): void {
    speedMultiplier = multiplier;
    apply();
  }

  function formatMultiplier(multiplier: number): string {
    return `${Number(multiplier.toPrecision(2))}×`;
  }

  function setEasing(points: CubicBezierPoints): void {
    easings = { ...easings, [activeEasing]: points };
    apply();
  }

  function selectSurface(next: string): void {
    surfaceId = next;
    const first = motionSurfaceById(next).easingNames[0];
    if (first !== undefined) activeEasing = first;
  }

  function resetCurve(): void {
    if (baseline === null) return;
    setEasing([...baseline.easings[activeEasing]] as CubicBezierPoints);
  }

  function resetAll(): void {
    if (baseline === null) return;
    speedMultiplier = 1;
    // $state.snapshot first: `baseline` is a reactive deep proxy, and structuredClone throws
    // DataCloneError on proxies — this line crashing silently is what made "Reset all" (and with
    // it every settle/standard recovery) a no-op in the first build (owner report 2026-07-02).
    easings = structuredClone($state.snapshot(baseline).easings);
    clearMotionOverrides();
    clearStoredOverrides();
  }

  async function copyReport(): Promise<void> {
    if (baseline === null) return;
    await navigator.clipboard.writeText(buildMotionReport(baseline, { speedMultiplier, easings }));
    reportCopied = true;
    setTimeout(() => (reportCopied = false), 2000);
  }
</script>

{#if baseline !== null}
  <div class="flex flex-col gap-12">
    <div class="flex flex-col gap-8">
      <div class="flex items-baseline justify-between gap-8">
        <p class="text-xs text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
          Transition speed
        </p>
        <p class="text-sm">{formatMultiplier(speedMultiplier)}</p>
      </div>
      <!-- A native range input: range is deliberately outside the Input component's remit, and
           this panel is developer chrome, not product UI — the UA widget is acceptable here. -->
      <input
        type="range"
        min="-1"
        max="1.3"
        step="0.01"
        value={Math.log10(speedMultiplier)}
        aria-label="Transition speed multiplier (logarithmic)"
        aria-valuetext={formatMultiplier(speedMultiplier)}
        class="w-full"
        oninput={(event) => {
          setSpeed(Number((10 ** Number.parseFloat(event.currentTarget.value)).toPrecision(2)));
        }}
      />
      <div class="flex gap-4">
        {#each SPEED_PRESETS as preset (preset)}
          <Button
            variant={speedMultiplier === preset ? "secondary" : "ghost"}
            size="sm"
            onclick={() => setSpeed(preset)}
          >
            {formatMultiplier(preset)}
          </Button>
        {/each}
      </div>
      <div class="flex gap-12 text-xs">
        {#each DURATION_RUNGS as rung (rung)}
          <!-- The selected surface's rungs read stronger; the rest stay muted. -->
          <span class={surface.durationRungs.includes(rung) ? "" : "text-muted"}>
            {rung}
            {Math.round(baseline.durations[rung] * speedMultiplier)}ms
          </span>
        {/each}
      </div>
    </div>

    <Separator />

    <div class="flex flex-col gap-8">
      <div class="flex items-center justify-between gap-8">
        <p class="text-xs text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
          Surface
        </p>
        {#if surface.replay !== null}
          <Button variant="secondary" size="sm" onclick={surface.replay}>
            <Play class="size-16" aria-hidden="true" />
            Replay
          </Button>
        {/if}
      </div>
      <Select.Root
        type="single"
        items={MOTION_SURFACES.map((entry) => ({ value: entry.id, label: entry.label }))}
        bind:value={() => surfaceId, selectSurface}
        allowDeselect={false}
      >
        <Select.Trigger aria-label="Motion surface" class="w-full">
          <Select.Value placeholder="Choose a surface" />
        </Select.Trigger>
        <Select.Content>
          {#each MOTION_SURFACES as entry (entry.id)}
            <Select.Item value={entry.id} label={entry.label} />
          {/each}
        </Select.Content>
      </Select.Root>
      {#if surface.note}
        <p class="text-xs text-muted">{surface.note}</p>
      {/if}
    </div>

    <Separator />

    <div class="flex flex-col gap-8">
      <div class="flex items-center justify-between gap-8">
        <p class="text-xs text-muted uppercase" style="letter-spacing: var(--mc-tracking-caps)">
          Easing curves
        </p>
        <div class="flex gap-4">
          {#each EASING_NAMES as name (name)}
            <Button
              variant={activeEasing === name ? "secondary" : "ghost"}
              size="sm"
              onclick={() => (activeEasing = name)}
            >
              {name}
            </Button>
          {/each}
        </div>
      </div>
      <EasingGraph value={easings[activeEasing]} onchange={setEasing} />
      <p class="text-xs text-muted" style="font-family: var(--mc-font-mono)">
        {formatCubicBezier(easings[activeEasing])}
      </p>
    </div>

    <Separator />

    <div class="flex justify-between gap-8">
      <Button variant="primary" size="sm" onclick={copyReport}>
        {#if reportCopied}
          <Check class="size-16" aria-hidden="true" />
          Copied
        {:else}
          <ClipboardCopy class="size-16" aria-hidden="true" />
          Copy motion report
        {/if}
      </Button>
      <div class="flex gap-4">
        <Button variant="ghost" size="sm" onclick={resetCurve}>Reset curve</Button>
        <Button variant="ghost" size="sm" onclick={resetAll}>Reset all</Button>
      </div>
    </div>
  </div>
{/if}
