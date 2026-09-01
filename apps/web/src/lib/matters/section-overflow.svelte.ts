/*
 * How a horizontal strip of sections decides what fits — measured, never guessed at a breakpoint.
 *
 * A breakpoint cannot answer this. What fits depends on the strip's own width (which the sidebar's
 * collapse and the window both move), on how long the section labels are, and on whether a maturity
 * badge rides beside each one. So the strip renders an invisible mirror of itself, reports each
 * item's intrinsic width, and this model turns those widths into a count.
 *
 * Two rules the arithmetic has to keep:
 *   - Measure every item at its WIDEST state (the active weight, badges included). Otherwise
 *     activating a section changes its width, which changes what fits, which moves the strip under
 *     the pointer that just clicked it.
 *   - The row carries no gap, so per-item widths sum exactly to the row. Padding belongs inside
 *     each item.
 *
 * The first item always holds the line: below one item the strip is too narrow to help anybody, and
 * a strip that folds everything into a menu has stopped being a strip.
 */

export class SectionOverflow {
  /** The visible row's width. Bound from the row element's clientWidth. */
  containerWidth = $state(0);
  /** The More trigger's width, reserved before any item is fitted. Bound from the mirror. */
  moreTriggerWidth = $state(0);
  /** Each item's intrinsic width at the active weight, in registry order. Bound from the mirror. */
  itemWidths = $state<number[]>([]);

  readonly #total: () => number;

  constructor(total: () => number) {
    this.#total = total;
    this.itemWidths = Array.from({ length: total() }, () => 0);
  }

  /** How many leading items render in the row; the rest fold into More. */
  get visibleCount(): number {
    const total = this.#total();
    // Until the mirror reports (the first client frame), show everything; the strip settles as
    // soon as the measurements land.
    if (
      this.containerWidth === 0 ||
      this.moreTriggerWidth === 0 ||
      this.itemWidths.length < total ||
      this.itemWidths.some((width) => width === 0)
    ) {
      return total;
    }
    const fullWidth = this.itemWidths.reduce((sum, width) => sum + width, 0);
    if (fullWidth <= this.containerWidth) {
      return total;
    }
    // Reserve room for the More trigger, then fit items greedily from the front of the registry.
    const available = this.containerWidth - this.moreTriggerWidth;
    let used = 0;
    let count = 0;
    for (const width of this.itemWidths) {
      if (used + width > available) {
        break;
      }
      used += width;
      count += 1;
    }
    return Math.max(count, 1);
  }
}
