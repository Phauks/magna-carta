/*
 * Pointer drag-to-reorder — the platform's FIRST drag treatment, deliberately small:
 *
 * - COMPOSITOR-ONLY MOTION: the dragged row follows the pointer via a translateY transform
 *   (runtime geometry, not a design value) plus an elevation class. The OTHER rows reflow LIVE
 *   to preview the drop — each shifts by one row PITCH (again a transform) to open a gap at the
 *   projected landing index, so the member sees where the row will seat before releasing. The
 *   drop COMMITS the new order as a plain, instant reorder. Every motion is a transform, so
 *   reduced-motion has nothing to suppress beyond the tween on the reflowing neighbours (the
 *   consumer drops that transition under prefers-reduced-motion; direct manipulation is not
 *   animation).
 * - The pointer path is one half; the KEYBOARD half lives with the consumer (a focused row
 *   moves one slot per modifier-arrow press through the same commit callback), because arrow
 *   semantics belong to the row widget, not this controller.
 * - PROMOTION PATH: app-side while its consumers are both in this app: the sidebar's Customize
 *   mode and the numbering editor's parts table, whose rows are table rows (the pitch is measured
 *   across `data-reorder-row` siblings, so a <tr> works as well as a list item). The next consumer
 *   moves this into @magna-carta/design-system as a primitive with a story and behavior tests.
 *
 * WHY IT USED TO STUTTER, and what each fix is for (owner report, 2026-09-16). Three defects
 * stacked, and any one of them alone was enough to make the rows judder:
 *
 *   1. IT MEASURED THE WRONG DISTANCE. The slot size came from the pressed element's own height,
 *      but rows are separated by a gap, so every slot was measured short by that gap. Travel of
 *      two rows read as travel of two-and-a-bit, and the preview jumped a slot ahead of the
 *      pointer and back. The PITCH — the distance from one row's top edge to the next one's — is
 *      the number this arithmetic wanted all along, and it is measured from the two rows
 *      themselves (`data-reorder-row`), never assumed.
 *   2. IT ROUNDED WITH NO DEAD BAND. `Math.round(travel / pitch)` flips at exactly half a row, so
 *      a pointer resting near a boundary — which is where a pointer rests, because that is where
 *      the member is deciding — crossed it back and forth on every hand tremor, and the whole
 *      list reflowed each time. The landing index is STICKY now: it takes six tenths of a row to
 *      move it, and four tenths to move it back, so a boundary is passed once.
 *   3. IT RE-RENDERED PER POINTER EVENT. A pointermove fires as fast as the device reports —
 *      several times per frame on a high-rate mouse — and each one wrote state and reflowed the
 *      list. The offset is now coalesced into one write per animation frame, which is the most a
 *      screen can show anyway.
 */

/** How far past a slot boundary the pointer must travel before the landing index follows it. */
const SLOT_HYSTERESIS = 0.6;

/** The attribute a consumer marks the element that actually moves — what the pitch is measured on. */
export const REORDER_ROW_ATTRIBUTE = "data-reorder-row";

export class DragReorderController {
  /** The id currently being dragged (null at rest) — drives the row's transform + elevation. */
  draggingId = $state<string | null>(null);
  /** The dragged row's pointer offset from its rest position, in pixels. */
  offsetY = $state(0);
  /** Whole slots travelled, with hysteresis applied — the landing index's only input. */
  #slotTravel = $state(0);

  #pointerId = 0;
  #startY = 0;
  #pitch = 0;
  #fromIndex = 0;
  #ids: readonly string[] = [];
  #minimumIndex = 0;
  #commit: ((id: string, toIndex: number) => void) | null = null;
  #element: HTMLElement | null = null;
  #pendingY: number | null = null;
  #frame = 0;

  /**
   * Begin dragging `id` from the row element under the pointer. `ids` is the group's current
   * order; the drop position is derived from travel in whole row pitches, clamped to
   * [minimumIndex, ids.length - 1].
   */
  start(
    event: PointerEvent,
    id: string,
    ids: readonly string[],
    commit: (id: string, toIndex: number) => void,
    minimumIndex = 0,
  ): void {
    if (event.button !== 0 || this.draggingId !== null) return;
    const element = event.currentTarget as HTMLElement | null;
    if (element === null) return;
    const fromIndex = ids.indexOf(id);
    if (fromIndex === -1) return;
    event.preventDefault();
    this.draggingId = id;
    this.offsetY = 0;
    this.#slotTravel = 0;
    this.#pointerId = event.pointerId;
    this.#startY = event.clientY;
    this.#pitch = measurePitch(element);
    this.#fromIndex = fromIndex;
    this.#ids = ids;
    this.#minimumIndex = minimumIndex;
    this.#commit = commit;
    this.#element = element;
    element.setPointerCapture(event.pointerId);
    element.addEventListener("pointermove", this.#onPointerMove);
    element.addEventListener("pointerup", this.#onPointerEnd);
    element.addEventListener("pointercancel", this.#onPointerCancel);
  }

  /**
   * The index the row would seat at if released now — sticky travel in whole row pitches from its
   * origin, clamped to the reorderable range. -1 at rest. Reactive through the slot travel.
   */
  get projectedIndex(): number {
    if (this.draggingId === null) return -1;
    return Math.max(
      this.#minimumIndex,
      Math.min(this.#ids.length - 1, this.#fromIndex + this.#slotTravel),
    );
  }

  /**
   * The live-reflow shift for a NON-dragged row, in pixels: rows between the origin and the
   * projected drop index slide one pitch to open the gap the dragged row will fill. The dragged
   * row itself (and rows outside the affected span) get 0. Reactive through the slot travel.
   */
  rowShift(id: string): number {
    if (this.draggingId === null || id === this.draggingId) return 0;
    const index = this.#ids.indexOf(id);
    if (index === -1) return 0;
    const projected = this.projectedIndex;
    const from = this.#fromIndex;
    // Dragging DOWN: rows just below the origin, up to and including the target, rise one slot.
    if (from < projected && index > from && index <= projected) return -this.#pitch;
    // Dragging UP: rows from the target up to just above the origin fall one slot.
    if (projected < from && index >= projected && index < from) return this.#pitch;
    return 0;
  }

  /*
   * Pointer events arrive faster than the screen refreshes, so the raw position is parked and one
   * write happens per frame. Without this the list reflowed several times between two paintings of
   * it, which costs the work and shows none of it.
   */
  #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) return;
    this.#pendingY = event.clientY;
    if (this.#frame !== 0) return;
    this.#frame = requestAnimationFrame(() => {
      this.#frame = 0;
      if (this.#pendingY === null || this.draggingId === null) return;
      this.offsetY = this.#pendingY - this.#startY;
      this.#advanceSlots();
    });
  };

  /**
   * Move the landing index toward where the pointer is, one slot at a time, and only once the
   * pointer is well past the boundary. The asymmetry is the whole point: crossing costs six tenths
   * of a row and uncrossing costs four, so a hand resting on a boundary settles instead of
   * oscillating.
   */
  #advanceSlots(): void {
    const raw = this.offsetY / this.#pitch;
    let travel = this.#slotTravel;
    while (raw > travel + SLOT_HYSTERESIS) travel += 1;
    while (raw < travel - SLOT_HYSTERESIS) travel -= 1;
    if (travel !== this.#slotTravel) this.#slotTravel = travel;
  }

  #onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) return;
    // The committed landing is exactly the previewed one — same computation as the live reflow.
    const toIndex = this.projectedIndex;
    const id = this.draggingId;
    const fromIndex = this.#fromIndex;
    this.#teardown();
    if (id !== null && toIndex !== fromIndex) {
      this.#commit?.(id, toIndex);
    }
    this.#commit = null;
  };

  #onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) return;
    this.#teardown();
    this.#commit = null;
  };

  #teardown(): void {
    if (this.#frame !== 0) {
      cancelAnimationFrame(this.#frame);
      this.#frame = 0;
    }
    this.#pendingY = null;
    this.#element?.removeEventListener("pointermove", this.#onPointerMove);
    this.#element?.removeEventListener("pointerup", this.#onPointerEnd);
    this.#element?.removeEventListener("pointercancel", this.#onPointerCancel);
    this.#element = null;
    this.draggingId = null;
    this.offsetY = 0;
    this.#slotTravel = 0;
  }
}

/**
 * The distance from one row's top edge to the next one's — height plus whatever separates them.
 * Measured from the two rows rather than computed, so a density change or a gap the list picks up
 * later keeps the drop arithmetic honest with no edit here.
 *
 * The rows are found by `data-reorder-row` on the element that MOVES, which is the element whose
 * pitch matters; the pressed element may be a control inside it. Falls back to the pressed
 * element's own height when there is only one row, where no drop is possible anyway.
 */
function measurePitch(pressed: HTMLElement): number {
  const row = pressed.closest<HTMLElement>(`[${REORDER_ROW_ATTRIBUTE}]`) ?? pressed;
  const rows = Array.from(
    row.parentElement?.parentElement?.querySelectorAll<HTMLElement>(`[${REORDER_ROW_ATTRIBUTE}]`) ??
      [],
  );
  const index = rows.indexOf(row);
  const neighbour = rows[index + 1] ?? rows[index - 1];
  if (neighbour !== undefined) {
    const pitch = Math.abs(neighbour.getBoundingClientRect().top - row.getBoundingClientRect().top);
    if (pitch >= 1) return pitch;
  }
  return Math.max(1, row.getBoundingClientRect().height);
}
