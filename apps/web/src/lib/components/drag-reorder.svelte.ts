/*
 * Pointer drag-to-reorder — the platform's FIRST drag treatment, deliberately small:
 *
 * - COMPOSITOR-ONLY MOTION: the dragged row follows the pointer via a translateY transform
 *   (runtime geometry, not a design value) plus an elevation class; the rest of the list
 *   stays put until the drop COMMITS the new order as a plain, instant reorder — no layout
 *   animation, nothing for reduced-motion to suppress (direct manipulation is not animation).
 * - The pointer path is one half; the KEYBOARD half lives with the consumer (a focused row
 *   moves one slot per modifier-arrow press through the same commit callback), because arrow
 *   semantics belong to the row widget, not this controller.
 * - PROMOTION PATH: app-side on purpose while it has one consumer (the sidebar's Customize
 *   mode). When a second reorderable list appears (table rows, kanban), this moves into
 *   @magna-carta/design-system as a primitive with a story and behavior tests.
 */

export class DragReorderController {
  /** The id currently being dragged (null at rest) — drives the row's transform + elevation. */
  draggingId = $state<string | null>(null);
  /** The dragged row's pointer offset from its rest position, in pixels. */
  offsetY = $state(0);

  #pointerId = 0;
  #startY = 0;
  #rowHeight = 0;
  #fromIndex = 0;
  #ids: readonly string[] = [];
  #minimumIndex = 0;
  #commit: ((id: string, toIndex: number) => void) | null = null;
  #element: HTMLElement | null = null;

  /**
   * Begin dragging `id` from the row element under the pointer. `ids` is the group's current
   * order; the drop position is derived from travel in whole row-heights, clamped to
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
    this.#pointerId = event.pointerId;
    this.#startY = event.clientY;
    // The row's own height is the slot size — measured, never assumed, so density changes
    // keep the drop math honest.
    this.#rowHeight = Math.max(1, element.getBoundingClientRect().height);
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

  #onPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) return;
    this.offsetY = event.clientY - this.#startY;
  };

  #onPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId !== this.#pointerId) return;
    const slotTravel = Math.round(this.offsetY / this.#rowHeight);
    const toIndex = Math.max(
      this.#minimumIndex,
      Math.min(this.#ids.length - 1, this.#fromIndex + slotTravel),
    );
    const id = this.draggingId;
    this.#teardown();
    if (id !== null && toIndex !== this.#fromIndex) {
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
    this.#element?.removeEventListener("pointermove", this.#onPointerMove);
    this.#element?.removeEventListener("pointerup", this.#onPointerEnd);
    this.#element?.removeEventListener("pointercancel", this.#onPointerCancel);
    this.#element = null;
    this.draggingId = null;
    this.offsetY = 0;
  }
}
