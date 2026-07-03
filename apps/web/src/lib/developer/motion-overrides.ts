/*
 * Developer-only motion overrides — the engine behind the developer menu's transition controls.
 *
 * Every animation in the app takes its duration and easing from the --mc-duration-* and
 * --mc-easing-* custom properties (the design-token contract), so "control every transition"
 * reduces to writing those few properties inline on <html>: no component opts in, nothing
 * re-renders, and clearing the inline values restores the shipped tokens exactly. The same
 * property indirection the user motion axis rides (data-motion re-points the ladder) is what
 * makes a live tuning panel possible at all.
 *
 * The baseline is read from computed style at mount — BEFORE any override is written — so it
 * reflects whatever the active theme/motion axis resolved (under a reduced/off motion axis the
 * durations are already shortened or zero, and a multiplier over zero stays zero: the tuning
 * panel never overrides an accessibility preference). Overrides persist per-browser in
 * localStorage so a tuning session survives reloads. This module is imported only by the
 * developer menu, which only exists in dev builds — none of it reaches production.
 */

import { createDeveloperConsoleStorage } from "./developer-console-storage.ts";

export const DURATION_RUNGS = ["fast", "normal", "slow", "signature"] as const;
export type DurationRung = (typeof DURATION_RUNGS)[number];

/* decelerate is a first-class register easing (the gilt tab-underline draw animates with it),
   so it is editable here like the other three; travel is reserved for route-level transitions
   and has no consumer yet. */
export const EASING_NAMES = ["settle", "travel", "standard", "decelerate"] as const;
export type EasingName = (typeof EASING_NAMES)[number];

/** The four cubic-bezier control values: x1, y1, x2, y2. */
export type CubicBezierPoints = [number, number, number, number];

export interface MotionBaseline {
  /** Token duration rungs in milliseconds, as resolved by the active theme/motion axis. */
  durations: Record<DurationRung, number>;
  easings: Record<EasingName, CubicBezierPoints>;
}

export interface MotionOverrides {
  /**
   * The master switch: false = the shipped tokens are live (no inline layer on <html>) while the
   * tuned set stays saved, so toggling gives an instant A/B between tuned and shipped feel.
   */
  enabled: boolean;
  /** Scales every duration rung; 1 = the shipped tokens. */
  speedMultiplier: number;
  easings: Record<EasingName, CubicBezierPoints>;
}

/* The "-2" invalidates overrides saved before the baseline was read correctly (early builds
   captured it through live overrides after a hot reload, so persisted values could be junk). */
const storage = createDeveloperConsoleStorage<MotionOverrides>("motion-overrides-2");

function durationProperty(rung: DurationRung): string {
  return `--mc-duration-${rung}`;
}

function easingProperty(name: EasingName): string {
  return `--mc-easing-${name}`;
}

function parseDurationMilliseconds(raw: string): number {
  const value = Number.parseFloat(raw);
  if (Number.isNaN(value)) return 0;
  return raw.trim().endsWith("ms") ? value : value * 1000;
}

function parseCubicBezier(raw: string): CubicBezierPoints | null {
  const match = /cubic-bezier\(([^)]+)\)/.exec(raw);
  const body = match?.[1];
  if (body === undefined) return null;
  const points = body.split(",").map((part) => Number.parseFloat(part));
  if (points.length !== 4 || points.some(Number.isNaN)) return null;
  return points as CubicBezierPoints;
}

export function formatCubicBezier(points: CubicBezierPoints): string {
  return `cubic-bezier(${points.join(", ")})`;
}

/** Read the resolved token values off <html>. Call BEFORE applying any override. */
export function readMotionBaseline(): MotionBaseline {
  const computed = getComputedStyle(document.documentElement);
  const durations = {} as Record<DurationRung, number>;
  for (const rung of DURATION_RUNGS) {
    durations[rung] = parseDurationMilliseconds(computed.getPropertyValue(durationProperty(rung)));
  }
  const easings = {} as Record<EasingName, CubicBezierPoints>;
  for (const name of EASING_NAMES) {
    // A non-bezier keyword (e.g. `linear` from a future token change) falls back to the linear
    // curve rather than breaking the panel.
    easings[name] = parseCubicBezier(computed.getPropertyValue(easingProperty(name))) ?? [
      0, 0, 1, 1,
    ];
  }
  return { durations, easings };
}

/** Write the overrides inline on <html>; every token-fed animation follows immediately. */
export function applyMotionOverrides(baseline: MotionBaseline, overrides: MotionOverrides): void {
  const style = document.documentElement.style;
  for (const rung of DURATION_RUNGS) {
    style.setProperty(
      durationProperty(rung),
      `${Math.round(baseline.durations[rung] * overrides.speedMultiplier)}ms`,
    );
  }
  for (const name of EASING_NAMES) {
    style.setProperty(easingProperty(name), formatCubicBezier(overrides.easings[name]));
  }
}

/** Remove the inline overrides so the shipped tokens resolve again. */
export function clearMotionOverrides(): void {
  const style = document.documentElement.style;
  for (const rung of DURATION_RUNGS) {
    style.removeProperty(durationProperty(rung));
  }
  for (const name of EASING_NAMES) {
    style.removeProperty(easingProperty(name));
  }
}

export function loadStoredOverrides(): MotionOverrides | null {
  const parsed = storage.load();
  if (parsed === null) return null;
  if (typeof parsed.speedMultiplier !== "number" || typeof parsed.easings !== "object") {
    return null;
  }
  // A stored payload from before an easing was added to EASING_NAMES lacks that curve; the
  // caller merges over the baseline, so partial payloads stay valid. A payload saved before the
  // master switch existed lacks `enabled` — treat it as on, the only behavior that existed then.
  return { ...parsed, enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true };
}

export function saveStoredOverrides(overrides: MotionOverrides): void {
  storage.save(overrides);
}

export function clearStoredOverrides(): void {
  storage.clear();
}
