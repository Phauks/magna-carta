/**
 * Contrast pairs: foreground/background semantic-token pairings that the
 * contrast gate verifies in every theme and mode permutation.
 *
 * This is a stub; the pairs (and the gate that consumes them) arrive in a
 * later task of the design-system slice.
 */
export interface ContrastPair {
  /** Semantic token identifier of the foreground (text or icon) color. */
  readonly foreground: string;
  /** Semantic token identifier of the background color it renders on. */
  readonly background: string;
}

export const contrastPairs: readonly ContrastPair[] = [];
