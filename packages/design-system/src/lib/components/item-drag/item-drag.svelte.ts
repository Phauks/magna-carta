/*
 * ONE drag gesture, shared by every surface that takes part in it.
 *
 * The file manager alone has four places a thing can be picked up or put down — the folder rail,
 * the file list, the icon grid and the breadcrumb — and before this they would have been four
 * copies of the same five handlers, each free to disagree about what a refusal looks like or when
 * state gets cleared. They are one object now: the surface says what may be dragged, what may
 * accept it and what a drop means, and this owns the gesture.
 *
 * WHAT THIS OWNS
 *   - the payload, written under our own media type (see item-drag.ts) so an upload dropped from
 *     the desktop can never be read as one of ours, or the other way round;
 *   - which destination is under the pointer, and the mark drawn on it;
 *   - REFUSING BY SILENCE. A destination that will not take the drop simply does not call
 *     `preventDefault`, which is how the platform is built: the pointer itself turns to "no drop"
 *     and the reader is told before they let go rather than after. There is no refusal banner for a
 *     gesture, because a gesture that is refused visibly never reaches one;
 *   - clearing everything on `dragend`, HOWEVER the gesture ended. A drag abandoned over the window
 *     chrome, cancelled with Escape, or dropped somewhere that refused it all end there, and a mark
 *     left painted on a row after the pointer has gone is the defect this single owner prevents.
 *
 * WHAT THE SURFACE OWNS: the keys. This module never parses one — it carries them, hands them back
 * to `accepts` and `onDrop`, and has no opinion about what a folder or a file is.
 *
 * TWO WAYS TO NAME AN ITEM, FOR ONE REASON. A surface that renders its own rows marks them with the
 * attributes in item-drag.ts and needs nothing else. A surface whose rows are rendered by ANOTHER
 * component — the file list's rows come out of the shared table — cannot add an attribute to them,
 * so a region may pass its own resolver instead and read whatever that component already stamps on
 * the row. The second form exists for that case only, and it answers with the ELEMENT as well as
 * the key, because the mark and the lift below both need the row rather than the cell under the
 * pointer.
 */
import {
  ITEM_DRAG_KEY_ATTRIBUTE,
  ITEM_DRAG_MEDIA_TYPE,
  ITEM_DROP_KEY_ATTRIBUTE,
  ITEM_DROP_MARK_ATTRIBUTE,
  encodeDraggedItems,
} from "./item-drag.ts";

/** An item an event landed on: what it is called, and the element standing for the whole of it. */
export interface ItemDragAnchor {
  readonly key: string;
  readonly element: HTMLElement;
}

/** How a region finds the item an event landed on. Both default to the module's own attributes. */
export interface ItemDragRegion {
  /** The item that may be PICKED UP here, or null where nothing may be. */
  readonly sourceAt?: (element: HTMLElement) => ItemDragAnchor | null;
  /** The destination that may ACCEPT here, or null where none may. */
  readonly targetAt?: (element: HTMLElement) => ItemDragAnchor | null;
}

export interface ItemDragOptions {
  /**
   * What pressing on `key` actually drags. Dragging one row of a selection drags the whole
   * selection, which is this function's job to say; answering with nothing refuses the drag before
   * it starts, which is how a row that cannot move (a rail's root) declines without a special case.
   */
  readonly keysFor: (key: string) => readonly string[];
  /** What the drag image says over a selection of more than one. A single drag shows its own row. */
  readonly describe: (keys: readonly string[]) => string;
  /** Whether these items may land on this destination. False refuses by silence; see above. */
  readonly accepts: (keys: readonly string[], targetKey: string) => boolean;
  /** The drop happened. The surface performs the move and records whatever it takes back. */
  readonly onDrop: (keys: readonly string[], targetKey: string) => void;
}

/** The handlers a region spreads onto its container element. */
export interface ItemDragHandlers {
  onpointerdown: (event: PointerEvent) => void;
  ondragstart: (event: DragEvent) => void;
  ondragover: (event: DragEvent) => void;
  ondragleave: (event: DragEvent) => void;
  ondrop: (event: DragEvent) => void;
  ondragend: () => void;
}

/** The nearest ancestor carrying `attribute`, as an anchor. */
function anchorBy(element: HTMLElement, attribute: string): ItemDragAnchor | null {
  const found = element.closest<HTMLElement>(`[${attribute}]`);
  const key = found?.getAttribute(attribute) ?? null;
  return found === null || key === null ? null : { key, element: found };
}

function elementOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof HTMLElement ? target : null;
}

export class ItemDrag {
  readonly #options: ItemDragOptions;
  #keys = $state<readonly string[]>([]);
  #targetKey = $state<string | null>(null);
  /** The element wearing the mark. Held so it can be un-marked without re-finding it. */
  #markedElement: HTMLElement | null = null;
  /** A row lifted into being draggable for the press it is under. See `onpointerdown`. */
  #lifted: HTMLElement | null = null;
  #dragImage: HTMLElement | null = null;

  constructor(options: ItemDragOptions) {
    this.#options = options;
  }

  /** The items in flight, empty when nothing is being dragged. */
  get draggedKeys(): readonly string[] {
    return this.#keys;
  }

  /** Whether one of OUR drags is in flight — the question an upload target asks before it opens. */
  get dragging(): boolean {
    return this.#keys.length > 0;
  }

  /** The destination under the pointer that would accept the drop, or null. */
  get markedTargetKey(): string | null {
    return this.#targetKey;
  }

  /** Whether `key` is one of the items in flight, for a surface that dims what it is carrying. */
  isDragging(key: string): boolean {
    return this.#keys.includes(key);
  }

  /** The five handlers plus the lift, ready to spread onto one region's container element. */
  handlers(region: ItemDragRegion = {}): ItemDragHandlers {
    const sourceAt = region.sourceAt ?? ((element) => anchorBy(element, ITEM_DRAG_KEY_ATTRIBUTE));
    const targetAt = region.targetAt ?? ((element) => anchorBy(element, ITEM_DROP_KEY_ATTRIBUTE));

    return {
      /*
       * A row is made draggable for the press it is under, and not before.
       *
       * The platform only starts a drag from an element carrying `draggable`, and the file list's
       * rows come out of the shared table, which does not put one there — nor should it, since a
       * table whose every row is permanently draggable loses text selection on every surface that
       * composes it. Lifting the row under the pointer for the duration of the press gives the
       * gesture what it needs and gives it back; markup that already declares `draggable` is left
       * exactly as it is.
       */
      onpointerdown: (event: PointerEvent) => {
        this.#releaseLift();
        const element = elementOf(event.target);
        const anchor = element === null ? null : sourceAt(element);
        if (anchor === null || anchor.element.draggable) return;
        if (this.#options.keysFor(anchor.key).length === 0) return;
        anchor.element.draggable = true;
        this.#lifted = anchor.element;
        // A press that turns out to be a click ends here, and the row gets its own behaviour back
        // without waiting for a drag that never started.
        if (typeof document !== "undefined") {
          document.addEventListener("pointerup", () => this.#releaseLift(), { once: true });
        }
      },

      ondragstart: (event: DragEvent) => {
        const element = elementOf(event.target);
        const anchor = element === null ? null : sourceAt(element);
        // NOT OURS, and left entirely alone: a table's column header being reordered, a link being
        // dragged out. Preventing the default here would cancel somebody else's gesture, and the
        // region is a container that every drag inside it bubbles through.
        if (anchor === null) return;
        const keys = this.#options.keysFor(anchor.key);
        const transfer = event.dataTransfer;
        if (keys.length === 0 || transfer === null) {
          // An item that cannot move. Refusing the gesture outright is kinder than starting one no
          // destination will ever accept.
          event.preventDefault();
          return;
        }
        transfer.effectAllowed = "move";
        transfer.setData(ITEM_DRAG_MEDIA_TYPE, encodeDraggedItems(keys));
        if (keys.length > 1) this.#showCount(transfer, this.#options.describe(keys));
        this.#keys = keys;
      },

      ondragover: (event: DragEvent) => {
        if (this.#keys.length === 0) return;
        const element = elementOf(event.target);
        const anchor = element === null ? null : targetAt(element);
        if (anchor === null || !this.#options.accepts(this.#keys, anchor.key)) {
          this.#mark(null, null);
          return;
        }
        // Preventing the default is the ONLY thing that says a drop may land here. Every refusal
        // above leaves it alone, and the pointer says no on the platform's own authority.
        event.preventDefault();
        if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
        this.#mark(anchor.key, anchor.element);
      },

      ondragleave: (event: DragEvent) => {
        const element = elementOf(event.target);
        const anchor = element === null ? null : targetAt(element);
        if (anchor !== null && anchor.key === this.#targetKey) this.#mark(null, null);
      },

      ondrop: (event: DragEvent) => {
        const keys = this.#keys;
        const key = this.#targetKey;
        if (keys.length === 0 || key === null) return;
        event.preventDefault();
        // The upload target wrapping this region asks the payload rather than the position, so it
        // would decline anyway — but a move should never reach a second handler at all.
        event.stopPropagation();
        this.#clear();
        this.#options.onDrop(keys, key);
      },

      ondragend: () => this.#clear(),
    };
  }

  #mark(key: string | null, element: HTMLElement | null): void {
    if (this.#markedElement !== null && this.#markedElement !== element) {
      this.#markedElement.removeAttribute(ITEM_DROP_MARK_ATTRIBUTE);
    }
    this.#markedElement = element;
    this.#targetKey = key;
    if (element !== null) element.setAttribute(ITEM_DROP_MARK_ATTRIBUTE, "true");
  }

  /*
   * The drag image over a selection: how many things are being carried.
   *
   * The browser's own image is the element under the pointer, which is right for one row and a lie
   * for eight — it shows the reader carrying a single file while seven others follow it silently.
   * The element has to be in the document and painted for `setDragImage` to snapshot it, so it is
   * parked off-screen the same way the clipboard fallback parks its holder (see
   * components/failure-details/copy-text.ts) and removed once the gesture ends.
   */
  #showCount(transfer: DataTransfer, caption: string): void {
    if (typeof document === "undefined") return;
    const badge = document.createElement("div");
    badge.className = "mc-item-drag-count";
    badge.textContent = caption;
    badge.style.position = "fixed";
    badge.style.insetBlockStart = "-9999px";
    badge.style.insetInlineStart = "-9999px";
    document.body.appendChild(badge);
    this.#dragImage = badge;
    transfer.setDragImage(badge, 0, 0);
  }

  /** Give a lifted row its own behaviour back. Safe to call when nothing is lifted. */
  #releaseLift(): void {
    if (this.#lifted === null) return;
    this.#lifted.draggable = false;
    this.#lifted = null;
  }

  #clear(): void {
    this.#mark(null, null);
    this.#keys = [];
    this.#releaseLift();
    if (this.#dragImage !== null) {
      this.#dragImage.remove();
      this.#dragImage = null;
    }
  }
}

/** The shared drag gesture, made once per surface and handed to every region taking part in it. */
export function createItemDrag(options: ItemDragOptions): ItemDrag {
  return new ItemDrag(options);
}

/** Reads a region's items out of an attribute another component already stamps on its rows. */
export function itemDragAnchorBy(
  attribute: string,
): (element: HTMLElement) => ItemDragAnchor | null {
  return (element) => anchorBy(element, attribute);
}
