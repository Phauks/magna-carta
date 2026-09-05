<script lang="ts">
  /*
   * The motion module — the developer console's first resident: live tuning of every animation
   * in the app through the token indirection (motion-overrides.ts writes a handful of custom
   * properties on <html>; every recipe follows). A master apply-overrides switch (instant A/B
   * between the tuned set and the shipped tokens), a speed multiplier, a surface picker over the
   * motion-surface registry (focus the controls on one animation, replay it where replayable),
   * an interactive cubic-bezier editor per easing token, and the copy-ready motion report — the
   * deliverable of a tuning session (motion-report.ts).
   */
  import { onMount } from "svelte";
  import Button from "@magna-carta/design-system/button";
  import * as Select from "@magna-carta/design-system/select";
  import Separator from "@magna-carta/design-system/separator";
  import Switch from "@magna-carta/design-system/switch";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import Check from "@lucide/svelte/icons/check";
  import ClipboardCopy from "@lucide/svelte/icons/clipboard-copy";
  import Play from "@lucide/svelte/icons/play";
  import EasingGraph from "../../easing-graph.svelte";
  import { buildMotionReport } from "../../motion-report.ts";
  import {
    PALETTE_ENTRANCE_VARIANTS,
    readPaletteEntranceVariant,
    savePaletteEntranceVariant,
    type PaletteEntranceVariant,
  } from "../../palette-entrance.ts";
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
    type MotionOverrides,
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
  let overridesEnabled = $state(true);
  // The palette-entrance trial (palette-entrance.ts): the persisted choice is read by the
  // command palette at each open, so this control needs no apply step — pick, then reopen.
  let paletteEntrance = $state<PaletteEntranceVariant>(readPaletteEntranceVariant());

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
      overridesEnabled = stored.enabled;
      if (stored.enabled) applyMotionOverrides(base, currentOverrides());
    }
  });

  function currentOverrides(): MotionOverrides {
    return { enabled: overridesEnabled, speedMultiplier, easings };
  }

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
      // With nothing tuned the master switch has nothing to disable, so it returns to on.
      clearMotionOverrides();
      clearStoredOverrides();
      overridesEnabled = true;
      return;
    }
    // Touching a control while the master switch is off means "I want to feel this change":
    // flip back on and apply, rather than silently editing a dormant set.
    overridesEnabled = true;
    applyMotionOverrides(baseline, currentOverrides());
    saveStoredOverrides(currentOverrides());
  }

  function setOverridesEnabled(next: boolean): void {
    overridesEnabled = next;
    if (baseline === null) return;
    if (next) {
      applyMotionOverrides(baseline, currentOverrides());
    } else {
      // Shipped tokens go live again; the tuned state and its storage stay for the flip back.
      clearMotionOverrides();
    }
    // A pristine set has nothing stored (apply() cleared it), so there is no flag to persist.
    if (!isPristine()) saveStoredOverrides(currentOverrides());
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
    overridesEnabled = true;
  }

  async function copyReport(): Promise<void> {
    if (baseline === null) return;
    await navigator.clipboard.writeText(buildMotionReport(baseline, currentOverrides()));
    reportCopied = true;
    setTimeout(() => (reportCopied = false), 2000);
  }
</script>

{#if baseline !== null}
  <div class="flex flex-col gap-12">
    <div class="flex items-center justify-between gap-8">
      <FieldLabel as="p">
        Apply overrides
      </FieldLabel>
      <Switch
        bind:checked={() => overridesEnabled, setOverridesEnabled}
        aria-label="Apply motion overrides"
      />
    </div>

    <Separator />

    <div class="flex flex-col gap-8">
      <div class="flex items-baseline justify-between gap-8">
        <FieldLabel as="p">
          Transition speed
        </FieldLabel>
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
          <span class={surface.durationRungs.includes(rung) ? "" : "text-text-muted"}>
            {rung}
            {Math.round(baseline.durations[rung] * speedMultiplier)}ms
          </span>
        {/each}
      </div>
    </div>

    <Separator />

    <div class="flex flex-col gap-8">
      <div class="flex items-center justify-between gap-8">
        <FieldLabel as="p">
          Surface
        </FieldLabel>
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
        <p class="text-xs text-text-muted">{surface.note}</p>
      {/if}
    </div>

    <Separator />

    <div class="flex flex-col gap-8">
      <div class="flex items-center justify-between gap-8">
        <FieldLabel as="p">
          Easing curves
        </FieldLabel>
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
      <p class="text-xs text-text-muted" style="font-family: var(--mc-font-mono)">
        {formatCubicBezier(easings[activeEasing])}
      </p>
    </div>

    <Separator />

    <div class="flex flex-col gap-8">
      <FieldLabel as="p">
        Palette entrance
      </FieldLabel>
      <Select.Root
        type="single"
        items={PALETTE_ENTRANCE_VARIANTS.map((variant) => ({
          value: variant.value,
          label: variant.label,
        }))}
        bind:value={
          () => paletteEntrance,
          (next) => {
            paletteEntrance = next as PaletteEntranceVariant;
            savePaletteEntranceVariant(paletteEntrance);
          }
        }
        allowDeselect={false}
      >
        <Select.Trigger aria-label="Palette entrance" class="w-full">
          <Select.Value placeholder="Choose an entrance" />
        </Select.Trigger>
        <Select.Content>
          {#each PALETTE_ENTRANCE_VARIANTS as variant (variant.value)}
            <Select.Item value={variant.value} label={variant.label} />
          {/each}
        </Select.Content>
      </Select.Root>
      <p class="text-xs text-text-muted">
        Trial of the command palette's entrance animation — applies the next time the palette
        opens (Ctrl+K).
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
