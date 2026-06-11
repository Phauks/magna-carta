import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge cannot see our CSS — it classifies utilities purely by class-name
 * pattern, so token names outside its default validators silently land in the wrong
 * class group (e.g. shadow-elevation-1 as a shadow COLOR) and conflicting classes
 * are then both kept.
 *
 * SYNC RULE: this configuration grows with the generated Tailwind theme in
 * packages/design-tokens/generated/tailwind-theme.css. The test suite derives its
 * cases from that generated file, so a token namespace added there without a
 * matching registration here fails loudly in test rather than silently in the UI.
 *
 * Verified against tailwind-merge 3.6.0 defaults — automatic, NO registration needed:
 *   spacing (numeric token names), radius (none/sm/md/lg/full), color (semantic
 *   names — any value), text sizes (t-shirt validator covers md/2xl), font families,
 *   font-weight medium/semibold, leading, tracking.
 * Registered below because the default validators miss them:
 *   shadow elevation-0..3, ease standard/decelerate/accelerate, font-weight regular.
 */
const tailwindMergeWithTokenNamespaces = extendTailwindMerge({
  extend: {
    theme: {
      shadow: ["elevation-0", "elevation-1", "elevation-2", "elevation-3"],
      ease: ["standard", "decelerate", "accelerate"],
      "font-weight": ["regular"],
    },
  },
});

/**
 * Combines class values (clsx semantics: strings, arrays, conditionals, records)
 * and resolves Tailwind utility conflicts — the later class wins. Token-namespace
 * aware: utilities generated from the @magna-carta/design-tokens theme merge
 * correctly against each other and against Tailwind's default scales.
 */
export function mergeClasses(...inputs: ClassValue[]): string {
  return tailwindMergeWithTokenNamespaces(clsx(inputs));
}

export type { ClassValue } from "clsx";
