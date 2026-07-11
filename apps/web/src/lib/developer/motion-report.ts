/*
 * The motion report: the paste-ready output of a tuning session. The developer fiddles until the
 * motion FEELS right, copies this, and hands it over — the final block is exactly the diff to
 * make permanent in the design-token source, so nothing is lost in translation between "what I
 * felt" and "what changes".
 */
import { buildIdentityLine } from "$lib/build-identity.ts";
import {
  DURATION_RUNGS,
  EASING_NAMES,
  formatCubicBezier,
  type MotionBaseline,
  type MotionOverrides,
} from "./motion-overrides.ts";

function readAxisContext(): string {
  const dataset = document.documentElement.dataset;
  const axis = (name: string): string => dataset[name] ?? "default";
  return `theme=${axis("theme")} mode=${axis("mode")} motion=${axis("motion")} density=${axis("density")}`;
}

export function buildMotionReport(baseline: MotionBaseline, overrides: MotionOverrides): string {
  const lines: string[] = [
    `Magna Carta motion report — ${new Date().toISOString()}`,
    `Build: ${buildIdentityLine()}`,
    `Context: ${readAxisContext()} (baseline is axis-resolved)`,
    `Speed multiplier: ${overrides.speedMultiplier}x`,
    "",
    "Durations (shipped -> tuned)",
  ];
  const permanent: string[] = [];

  for (const rung of DURATION_RUNGS) {
    const shipped = baseline.durations[rung];
    const tuned = Math.round(shipped * overrides.speedMultiplier);
    const delta = tuned - shipped;
    const deltaText = delta === 0 ? "" : `   (${delta > 0 ? "+" : ""}${delta}ms)`;
    lines.push(`  ${rung.padEnd(10)} ${shipped}ms -> ${tuned}ms${deltaText}`);
    if (delta !== 0) permanent.push(`  motion.duration.${rung} = ${tuned}ms`);
  }

  lines.push("", "Easings (shipped -> tuned)");
  for (const name of EASING_NAMES) {
    const shipped = formatCubicBezier(baseline.easings[name]);
    const tuned = formatCubicBezier(overrides.easings[name]);
    if (tuned === shipped) {
      lines.push(`  ${name.padEnd(10)} ${shipped}  -> unchanged`);
    } else {
      lines.push(`  ${name.padEnd(10)} ${shipped}  -> ${tuned}   CHANGED`);
      permanent.push(`  motion.easing.${name} = ${tuned}`);
    }
  }

  lines.push("");
  if (permanent.length === 0) {
    lines.push("No changes — everything is at the shipped tokens.");
  } else {
    lines.push("Token values to make permanent (packages/design-tokens source):", ...permanent);
  }
  return lines.join("\n");
}
