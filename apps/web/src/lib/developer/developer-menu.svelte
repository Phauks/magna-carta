<script lang="ts">
  /*
   * DeveloperMenu — the flask in the top bar (dev builds only, left of the profile circle):
   * controls the FIRM's users must never have, for fiddling with the running app while designing
   * it. First residents: a global transition-speed multiplier and a live cubic-bezier editor over
   * the easing tokens (owner request 2026-07-02 — the slow-motion console trick proved the need).
   *
   * Everything here rides the token indirection (see motion-overrides.ts): write a few custom
   * properties on <html> and every animation in the app follows. Overrides persist per-browser;
   * "Reset all" restores the shipped tokens exactly. The shell mounts this component inside an
   * `import.meta.env.DEV` gate via dynamic import, so none of it reaches a production bundle.
   */
  import { onMount } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import * as Popover from "@magna-carta/design-system/popover";
  import Separator from "@magna-carta/design-system/separator";
  import FlaskConical from "@lucide/svelte/icons/flask-conical";
  import EasingGraph from "./easing-graph.svelte";
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
  } from "./motion-overrides.ts";

  const SPEED_PRESETS = [0.25, 1, 3, 10] as const;

  let baseline = $state<MotionBaseline | null>(null);
  let speedMultiplier = $state(1);
  let easings = $state<Record<EasingName, CubicBezierPoints>>({
    settle: [0, 0, 1, 1],
    travel: [0, 0, 1, 1],
    standard: [0, 0, 1, 1],
  });
  let activeEasing = $state<EasingName>("settle");

  onMount(() => {
    // Baseline first — computed style must be read before any inline override lands.
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
        (name) =>
          formatCubicBezier(easings[name]) === formatCubicBezier(baseline!.easings[name]),
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

  function resetCurve(): void {
    if (baseline === null) return;
    setEasing([...baseline.easings[activeEasing]] as CubicBezierPoints);
  }

  function resetAll(): void {
    if (baseline === null) return;
    speedMultiplier = 1;
    easings = structuredClone(baseline.easings);
    clearMotionOverrides();
    clearStoredOverrides();
  }

  /* Replay through the real trigger so the toggle takes the exact production path
     (runViewTransition, direction marker and all) — the panel stays open to watch from. */
  function toggleSidebar(): void {
    document.querySelector<HTMLButtonElement>(".mc-sidebar .mc-sidebar-trigger")?.click();
  }
</script>

<Popover.Root>
  <Popover.Trigger class="mc-top-bar-icon-button" aria-label="Developer settings">
    <FlaskConical class="size-20" aria-hidden="true" />
  </Popover.Trigger>
  <Popover.Content
    align="end"
    class="flex flex-col gap-12 overflow-y-auto"
    style="inline-size: var(--mc-size-prose); max-block-size: var(--bits-popover-content-available-height)"
  >
    <div class="flex items-baseline justify-between gap-8">
      <p
        class="text-xs font-semibold text-muted uppercase"
        style="letter-spacing: var(--mc-tracking-caps)"
      >
        Developer settings
      </p>
      <p class="text-xs text-muted">Dev builds only · saved in this browser</p>
    </div>

    {#if baseline !== null}
      <div class="flex flex-col gap-8">
        <div class="flex items-baseline justify-between gap-8">
          <p
            class="text-xs text-muted uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
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
        <div class="flex gap-12 text-xs text-muted">
          {#each DURATION_RUNGS as rung (rung)}
            <span>{rung} {Math.round(baseline.durations[rung] * speedMultiplier)}ms</span>
          {/each}
        </div>
      </div>

      <Separator />

      <div class="flex flex-col gap-8">
        <div class="flex items-center justify-between gap-8">
          <p
            class="text-xs text-muted uppercase"
            style="letter-spacing: var(--mc-tracking-caps)"
          >
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
        <Button variant="secondary" size="sm" onclick={toggleSidebar}>Toggle sidebar</Button>
        <div class="flex gap-4">
          <Button variant="ghost" size="sm" onclick={resetCurve}>Reset curve</Button>
          <Button variant="ghost" size="sm" onclick={resetAll}>Reset all</Button>
        </div>
      </div>
    {/if}
  </Popover.Content>
</Popover.Root>
