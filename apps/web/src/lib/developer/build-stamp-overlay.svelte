<script lang="ts">
  /*
   * The build-stamp overlay — a dev-only floating badge pinning the live clock beside this
   * build's identity (commit, mode, build time), so a screen recording or a bug screenshot
   * always carries "when, and which build". Dev builds only: the app shell mounts it behind an
   * import.meta.env.DEV branch gated by the Settings · Developer flags (developer-preferences),
   * so none of it reaches a production bundle. The chosen corner is per-browser tuning state, not
   * application data — drag the badge (or arrow-key it while focused) to any of the four corners
   * and the choice persists through the same localStorage seam the developer-console modules use.
   */
  import GripVertical from "@lucide/svelte/icons/grip-vertical";
  import { BUILD_IDENTITY } from "$lib/build-identity.ts";
  import { createDeveloperConsoleStorage } from "./developer-console-storage.ts";

  type Corner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
  const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

  function isCorner(value: unknown): value is Corner {
    return typeof value === "string" && (CORNERS as readonly string[]).includes(value);
  }

  const storage = createDeveloperConsoleStorage<Corner>("build-stamp-overlay");
  const stored = storage.load();
  let corner = $state<Corner>(isCorner(stored) ? stored : "bottom-right");

  function moveTo(next: Corner): void {
    corner = next;
    storage.save(next);
  }

  // The live clock: a Date advanced once a second by its own interval, cleared on destroy. The
  // effect keeps the timer's ownership local and disposable and only ever runs in the browser.
  let now = $state(new Date());
  $effect(() => {
    const id = setInterval(() => (now = new Date()), 1000);
    return () => clearInterval(id);
  });

  const clockFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
  const builtAtFormat = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const clock = $derived(clockFormat.format(now));
  const builtAt = builtAtFormat.format(new Date(BUILD_IDENTITY.builtAt));

  // Positioning: fixed, anchored to the chosen corner with a uniform inset. During a pointer drag
  // the badge follows the pointer via a transform on top of that anchor (direct manipulation, so
  // nothing to suppress under reduced motion); on release it snaps to whichever corner its centre
  // landed nearest and the transform is dropped — the corner switch itself is an instant reposition.
  const INSET: Record<Corner, string> = {
    "top-left": "top: var(--mc-space-16); left: var(--mc-space-16)",
    "top-right": "top: var(--mc-space-16); right: var(--mc-space-16)",
    "bottom-left": "bottom: var(--mc-space-16); left: var(--mc-space-16)",
    "bottom-right": "bottom: var(--mc-space-16); right: var(--mc-space-16)",
  };

  let badge = $state<HTMLElement>();
  let dragging = $state(false);
  let dragX = $state(0);
  let dragY = $state(0);
  let startX = 0;
  let startY = 0;
  // The badge's resting centre, captured at pointer-down — snapping reads this rather than a live
  // getBoundingClientRect (which would already carry the drag transform Svelte has not yet cleared).
  let startCentreX = 0;
  let startCentreY = 0;

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const rect = badge?.getBoundingClientRect();
    if (rect !== undefined) {
      startCentreX = rect.left + rect.width / 2;
      startCentreY = rect.top + rect.height / 2;
    }
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    dragX = 0;
    dragY = 0;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    dragX = event.clientX - startX;
    dragY = event.clientY - startY;
  }

  function onPointerUp(event: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    const centreX = startCentreX + (event.clientX - startX);
    const centreY = startCentreY + (event.clientY - startY);
    dragX = 0;
    dragY = 0;
    const horizontal = centreX < window.innerWidth / 2 ? "left" : "right";
    const vertical = centreY < window.innerHeight / 2 ? "top" : "bottom";
    moveTo(`${vertical}-${horizontal}`);
  }

  // Keyboard: an arrow key picks the corner's half in that axis, so the badge is reachable without
  // a pointer and stays predictable — Left always means the left column, Up the top row.
  function onKeydown(event: KeyboardEvent): void {
    const [vertical, horizontal] = corner.split("-") as ["top" | "bottom", "left" | "right"];
    let next: Corner | null = null;
    if (event.key === "ArrowLeft") next = `${vertical}-left`;
    else if (event.key === "ArrowRight") next = `${vertical}-right`;
    else if (event.key === "ArrowUp") next = `top-${horizontal}`;
    else if (event.key === "ArrowDown") next = `bottom-${horizontal}`;
    if (next === null) return;
    event.preventDefault();
    moveTo(next);
  }
</script>

<div
  bind:this={badge}
  class="fixed z-toast flex select-none items-center gap-8 rounded-md border bg-chrome-surface py-8 pe-12 ps-8 tabular-nums shadow-elevation-2"
  style="{INSET[corner]}; color: var(--mc-chrome-text); border-color: var(--mc-chrome-border);{dragging
    ? ` transform: translate(${dragX}px, ${dragY}px);`
    : ''}"
>
  <button
    type="button"
    class="mc-top-bar-icon-button shrink-0"
    style="touch-action: none; cursor: {dragging ? 'grabbing' : 'grab'}"
    aria-label="Move the build stamp. Drag it, or press the arrow keys, to send it to a screen corner."
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onkeydown={onKeydown}
  >
    <GripVertical class="size-16" aria-hidden="true" />
  </button>
  <div class="flex flex-col gap-4 text-xs leading-tight">
    <span class="font-semibold" style="color: var(--mc-chrome-text-strong)">{clock}</span>
    <span style="color: var(--mc-chrome-text-muted)">
      {BUILD_IDENTITY.commit} · {BUILD_IDENTITY.mode} · built {builtAt}
    </span>
  </div>
</div>
