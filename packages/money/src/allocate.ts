import { allocateDinero } from "./dinero.ts";
import type { Money } from "./money.ts";

// Largest-remainder split: parts always sum exactly to the input (no penny drift). Spec §1.4.
// Weights are integer ratios (Dinero distributes any remainder as evenly as possible).
export function allocate(value: Money, weights: number[]): Money[] {
  return allocateDinero(value, weights) as Money[];
}
