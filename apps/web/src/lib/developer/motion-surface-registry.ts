/*
 * The motion-surface registry: which app surfaces consume which duration rung and easing token,
 * so the motion module can focus its controls on one surface at a time and replay the real
 * animation where one is replayable. Sources of truth for the mapping are the design-system
 * recipes (packages/design-system/src/lib/styles/recipes/presence.css, animations.css, and the
 * per-component css) — when a recipe re-points a surface to a different rung or easing, this
 * table is the one place to update.
 */
import { isApplePlatform } from "@magna-carta/design-system/internal/platform";
import type { DurationRung, EasingName } from "./motion-overrides.ts";

export interface MotionSurface {
  id: string;
  label: string;
  /** The duration rungs this surface consumes — highlighted in the readout when selected. */
  durationRungs: readonly DurationRung[];
  /** The easing tokens this surface consumes; the first becomes the active curve on selection. */
  easingNames: readonly EasingName[];
  /** Fires the real production animation; null when hover-driven or no consumer exists yet. */
  replay: (() => void) | null;
  /** Shown under the picker: what to watch, or why there is nothing to replay. */
  note?: string;
}

export const ALL_SURFACES_ID = "all";

export const MOTION_SURFACES: readonly MotionSurface[] = [
  {
    id: ALL_SURFACES_ID,
    label: "All surfaces",
    durationRungs: ["fast", "normal", "slow", "signature"],
    easingNames: ["settle", "travel", "standard", "decelerate"],
    replay: null,
  },
  {
    id: "sidebar",
    label: "Sidebar collapse / expand",
    durationRungs: ["normal"],
    easingNames: ["settle"],
    // The real trigger, so the replay takes the exact production path (view transition,
    // direction marker and all).
    replay: () =>
      document.querySelector<HTMLButtonElement>(".mc-sidebar .mc-sidebar-trigger")?.click(),
  },
  {
    id: "command-palette",
    label: "Command palette",
    durationRungs: ["fast"],
    easingNames: ["standard"],
    // The palette chord through the shell's real window listener — the dialog opens with its
    // production presence animation. Escape closes it.
    replay: () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "k",
          ctrlKey: !isApplePlatform(),
          metaKey: isApplePlatform(),
          bubbles: true,
        }),
      ),
    note: "Opens the real palette; Escape closes it.",
  },
  {
    id: "menus-popovers",
    label: "Menus & popovers",
    durationRungs: ["fast"],
    easingNames: ["standard"],
    replay: null,
    note: "Open any menu to watch — this console is one.",
  },
  {
    id: "sheets",
    label: "Sheets (side panels)",
    durationRungs: ["slow", "fast"],
    easingNames: ["standard"],
    replay: null,
    note: "No app surface ships a sheet yet.",
  },
  {
    id: "tooltips-scrims",
    label: "Tooltips & overlay scrims",
    durationRungs: ["fast"],
    easingNames: ["standard"],
    replay: null,
    note: "Hover-driven — hover a collapsed-rail icon to watch.",
  },
  {
    id: "gilt-draw",
    label: "Gilt draw (tab underlines)",
    durationRungs: ["normal"],
    easingNames: ["decelerate"],
    replay: null,
    note: "No app surface renders tabs yet.",
  },
  {
    id: "signature-moments",
    label: "Signature moments",
    durationRungs: ["signature"],
    easingNames: ["settle"],
    replay: null,
    note: "Reserved — the first signature choreography is still to land.",
  },
];

export function motionSurfaceById(id: string): MotionSurface {
  return MOTION_SURFACES.find((surface) => surface.id === id) ?? MOTION_SURFACES[0]!;
}
