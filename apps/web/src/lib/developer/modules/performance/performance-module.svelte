<script lang="ts">
  /*
   * The performance module — a live FPS meter for eyeballing the app's responsiveness while
   * designing (does a transition or a scroll drop frames?), plus the "static loading placeholders"
   * switch that freezes the skeleton pulse app-wide (never-loading "Soon" seams stop shimmering).
   * The meter's requestAnimationFrame loop runs ONLY while this module is mounted — opening a
   * different console tab, or closing the console, unmounts it and stops the loop, so it never
   * taxes the very responsiveness it measures.
   */
  import Switch from "@magna-carta/design-system/switch";
  import FieldLabel from "@magna-carta/design-system/field-label";
  import { applyStaticSkeletons, readStaticSkeletons } from "../../static-skeletons.ts";

  let fps = $state(0);
  let fpsLow = $state(0);
  let staticSkeletons = $state(readStaticSkeletons());

  $effect(() => {
    let last = performance.now();
    let elapsed = 0;
    let frames = 0;
    let raf = 0;
    // Report a rolling FPS four times a second: enough to see a stutter, calm enough to read.
    const loop = (now: number): void => {
      elapsed += now - last;
      last = now;
      frames += 1;
      if (elapsed >= 250) {
        const value = Math.round((frames * 1000) / elapsed);
        fps = value;
        fpsLow = fpsLow === 0 ? value : Math.min(fpsLow, value);
        elapsed = 0;
        frames = 0;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  });

  function resetLow(): void {
    fpsLow = fps;
  }

  function setStaticSkeletons(next: boolean): void {
    staticSkeletons = next;
    applyStaticSkeletons(next);
  }
</script>

<div class="flex flex-col gap-16">
  <div class="flex flex-col gap-8">
    <FieldLabel as="p">
      Frame rate
    </FieldLabel>
    <div class="flex items-baseline gap-8">
      <span class="text-3xl font-semibold tabular-nums">{fps}</span>
      <span class="text-sm text-text-muted">fps</span>
      <button
        type="button"
        class="ms-auto text-xs text-text-muted underline-offset-2 hover:underline"
        onclick={resetLow}
      >
        Reset low
      </button>
    </div>
    <p class="text-xs text-text-muted">
      Low since reset: <span class="tabular-nums">{fpsLow}</span> fps — a live read of the render
      loop; drops show where a transition or scroll costs frames.
    </p>
  </div>

  <div class="flex items-start justify-between gap-12">
    <div class="flex flex-col gap-2">
      <p class="text-sm">Static loading placeholders</p>
      <p class="text-xs text-text-muted">
        Freeze the skeleton pulse app-wide, so seams that will never load stop shimmering.
      </p>
    </div>
    <Switch
      checked={staticSkeletons}
      onCheckedChange={setStaticSkeletons}
      aria-label="Static loading placeholders"
    />
  </div>
</div>
