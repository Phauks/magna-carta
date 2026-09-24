/*
 * Turning the member's pointer, wheel and keys into the live stream's input frames — the arithmetic
 * and the filtering, kept off the DOM so each rule is a test rather than a hunch.
 *
 * WHERE A CLICK LANDS. The remote screen is drawn into the member's canvas scaled to fit and
 * centred (letterboxed when the two shapes differ), so a pointer position is mapped through that
 * fit to the remote viewport's own pixels. A click in the letterbox band is on nothing and is not
 * sent at all.
 *
 * WHICH KEYS GO. Every key the member presses while the screen has focus is the remote page's, with
 * three exceptions that belong to the member: the paste chord (so the browser raises the paste
 * event that carries their clipboard text across, the only way it can cross), keys the browser
 * reports without a usable name (dead keys and composition), and the way out — Escape pressed twice
 * in quick succession leaves the screen, because a surface that takes every key must not be one the
 * keyboard cannot leave.
 */
import {
  MODIFIER_ALT,
  MODIFIER_CONTROL,
  MODIFIER_META,
  MODIFIER_SHIFT,
  type PointerButton,
} from "@magna-carta/safe-browse/live-stream-protocol";

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FrameSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Where a pointer at (clientX, clientY) falls on the remote screen, or null when it falls in the
 * letterbox around it. `box` is the canvas's rendered box; the frame is drawn inside it scaled to
 * fit and centred.
 */
export function remotePoint(
  pointer: { clientX: number; clientY: number },
  box: Box,
  frame: FrameSize,
): { x: number; y: number } | null {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return null;
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const drawnWidth = frame.width * scale;
  const drawnHeight = frame.height * scale;
  const offsetX = (box.width - drawnWidth) / 2;
  const offsetY = (box.height - drawnHeight) / 2;
  const x = (pointer.clientX - box.left - offsetX) / scale;
  const y = (pointer.clientY - box.top - offsetY) / scale;
  if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) return null;
  return { x, y };
}

/** The remote side's modifier bitmask for an event's held modifier keys. */
export function modifiersOf(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? MODIFIER_ALT : 0) |
    (event.ctrlKey ? MODIFIER_CONTROL : 0) |
    (event.metaKey ? MODIFIER_META : 0) |
    (event.shiftKey ? MODIFIER_SHIFT : 0)
  );
}

/** A DOM pointer button number as the remote side names it. */
export function pointerButton(button: number): PointerButton {
  if (button === 0) return "left";
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "none";
}

// What one "line" and one "page" of wheel travel are, in pixels, when a device reports in those
// units rather than pixels. The line height is the common browser default.
const LINE_PIXELS = 16;

/** A wheel event's travel in pixels, whatever unit the device reported it in. */
export function wheelPixels(
  event: { deltaX: number; deltaY: number; deltaMode: number },
  pageHeight: number,
): { deltaX: number; deltaY: number } {
  const unit = event.deltaMode === 1 ? LINE_PIXELS : event.deltaMode === 2 ? pageHeight : 1;
  const bound = (value: number) => Math.max(-10_000, Math.min(10_000, value * unit));
  return { deltaX: bound(event.deltaX), deltaY: bound(event.deltaY) };
}

// Names the browser gives keys that type nothing on their own: a dead key waiting for its letter,
// an input method composing, a key it could not identify. Sending these would type garbage.
const UNSENDABLE_KEYS = new Set(["Dead", "Process", "Unidentified", "Compose"]);

/** Whether a key press belongs to the remote page (true) or to the member's own browser (false). */
export function forwardsKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing: boolean;
}): boolean {
  if (event.isComposing || UNSENDABLE_KEYS.has(event.key) || event.key.length > 32) return false;
  // The paste chord raises the paste event, which is how the member's clipboard text crosses.
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") return false;
  return true;
}

/** How quickly the second Escape must follow the first to mean "leave the screen". */
export const ESCAPE_LEAVE_WINDOW_MILLISECONDS = 600;

/** Whether this Escape, following one at `previousEscapeAt`, is the member asking to leave. */
export function isLeaveGesture(key: string, now: number, previousEscapeAt: number | null): boolean {
  return (
    key === "Escape" &&
    previousEscapeAt !== null &&
    now - previousEscapeAt <= ESCAPE_LEAVE_WINDOW_MILLISECONDS
  );
}
