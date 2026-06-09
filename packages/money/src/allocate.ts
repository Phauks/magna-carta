import { allocateDinero } from "./dinero.ts";
import type { Money } from "./money.ts";

// Largest-remainder split: parts always sum exactly to the input (no penny drift).
// Weights may be fractional (Dinero scales them internally and distributes any remainder as evenly
// as possible); an empty, all-zero, or negative weight list fails loud ("Ratios are invalid").
export function allocate(value: Money, weights: number[]): Money[] {
  return allocateDinero(value, weights) as Money[];
}
