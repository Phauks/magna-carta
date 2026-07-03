/*
 * Signature motion — the ONLY import site of anime.js (a boundary gate in test/fitness enforces
 * this, the same discipline floating.ts holds for z-index). The library serves the THIRD motion
 * lane only: signature-moment choreography (the written-live wordmark, hero sequences, staggered
 * ceremonial entrances). Functional motion stays lane one (CSS keyframes/transitions — the token
 * overlay makes them axis-compliant structurally) and layout change stays lane two (View
 * Transitions). If a piece of workflow feedback wants this module, it is in the wrong lane.
 *
 * Contracts this wrapper enforces so call sites cannot break the platform laws:
 *  - Lazy by construction: `import("animejs")` happens inside the functions — the library never
 *    rides the hot path (golden rule 10) and costs nothing until a ceremonial surface asks.
 *  - Compositor-only: the keyframe type admits `transform`/`opacity` only. The single documented
 *    exception is SVG stroke drawing (`drawStroke`) — paint-only, on ceremonial surfaces where
 *    nothing reflows.
 *  - CSP: anime.js animates via element.style (CSSOM) — the clean channel the csp-spike verdict
 *    blessed. Never inject <style>.
 *  - Motion axis: every entry point consults motion-preference.ts; `reduced`/`off` JUMP TO THE
 *    END STATE (never "skip the call") so completion semantics survive the accommodation.
 *  - Tokens stay authoritative: durations/easings default from the --mc-duration-signature /
 *    --mc-easing-settle custom properties at call time, so JS choreography re-tunes with the
 *    token file like every recipe.
 */
import { prefersReducedMotion } from "./motion-preference.ts";

/** Compositor-only keyframe surface — transform and opacity, nothing else. */
export interface SignatureKeyframes {
  transform?: string | string[];
  opacity?: number | number[];
}

export interface SignatureOptions {
  /** Milliseconds; defaults to the --mc-duration-signature token. */
  duration?: number;
  /** CSS easing expression; defaults to the --mc-easing-settle token. */
  easing?: string;
  /** Milliseconds of start delay (e.g. a stagger computed by the caller). */
  delay?: number;
}

function tokenValue(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

function tokenDurationMs(fallbackMs: number): number {
  const raw = tokenValue("--mc-duration-signature", `${fallbackMs}ms`);
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed)) return fallbackMs;
  return raw.endsWith("ms") ? parsed : parsed * 1000;
}

function lastFrame(keyframes: SignatureKeyframes): { transform?: string; opacity?: number } {
  const last = <T>(value: T | T[] | undefined): T | undefined =>
    Array.isArray(value) ? value[value.length - 1] : value;
  const transform = last(keyframes.transform);
  const opacity = last(keyframes.opacity);
  return {
    ...(transform === undefined ? {} : { transform }),
    ...(opacity === undefined ? {} : { opacity }),
  };
}

/**
 * Animate a signature moment (transform/opacity choreography). Under reduced/off motion the
 * element jumps straight to the final frame — the moment completes, it just doesn't perform.
 */
export async function animateSignature(
  element: HTMLElement | SVGElement,
  keyframes: SignatureKeyframes,
  options: SignatureOptions = {},
): Promise<void> {
  const final = lastFrame(keyframes);
  if (prefersReducedMotion()) {
    if (final.transform !== undefined) element.style.transform = final.transform;
    if (final.opacity !== undefined) element.style.opacity = String(final.opacity);
    return;
  }
  const { animate } = await import("animejs");
  await animate(element, {
    ...keyframes,
    duration: options.duration ?? tokenDurationMs(500),
    ease: options.easing ?? tokenValue("--mc-easing-settle", "cubic-bezier(0.23, 1, 0.32, 1)"),
    delay: options.delay ?? 0,
  }).then();
}

/**
 * Draw an SVG stroke (the written-live wordmark seam) — the documented paint-only exception to
 * the transform/opacity rule. Under reduced/off motion the path appears fully drawn at once.
 */
export async function drawStroke(
  path: SVGPathElement | SVGLineElement | SVGPolylineElement,
  options: SignatureOptions = {},
): Promise<void> {
  if (prefersReducedMotion()) return; // the un-animated path is already fully drawn
  const { animate, svg } = await import("animejs");
  await animate(svg.createDrawable(path), {
    draw: "0 1",
    duration: options.duration ?? tokenDurationMs(500),
    ease: options.easing ?? tokenValue("--mc-easing-settle", "cubic-bezier(0.23, 1, 0.32, 1)"),
    delay: options.delay ?? 0,
  }).then();
}
