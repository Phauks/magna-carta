/*
 * The maturity system — how finished a surface is, said in one vocabulary — and the Soon
 * affordance, which applies its "soon" stage to a single control. The model (maturity.ts) and the
 * affordance's wording (soon-affordance.ts) are plain modules so their sentences can be pinned by a
 * test; the three components read them. House namespace shape: bare names, and the same names
 * again so `import { MaturityBadge }` and `import * as Maturity` both read naturally.
 */
export { default as MaturityBadge } from "./maturity-badge.svelte";
export { default as MaturityDot } from "./maturity-dot.svelte";
export { default as SoonAffordance } from "./soon-affordance.svelte";
export {
  MATURITY_PRESENTATION,
  hasSurface,
  type MaturityPresentation,
  type MaturityStage,
} from "./maturity.ts";
export {
  soonControlProperties,
  soonDependencySentence,
  type SoonControlProperties,
} from "./soon-affordance.ts";
