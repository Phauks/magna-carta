/*
 * The frames that cross a live browsing stream, in both directions — the one home for their shapes,
 * shared by the Worker that drives the remote browser and the page that shows it.
 *
 * WHAT CROSSES TO THE MEMBER is pictures and text, the same promise the static capture makes: JPEG
 * frames of the remote screen, the address it is on, and the facts the inspector panel shows. No
 * markup, no script, nothing the member's browser would execute. Streaming changes how often a
 * picture arrives, not what a picture is.
 *
 * WHAT CROSSES FROM THE MEMBER is input: a pointer at a position, a key, a scroll, some pasted text,
 * an address. Every one of those arrives from a socket anybody holding the member's cookie could
 * write to, so `parseLiveClientMessage` treats each frame as hostile: unknown types are dropped,
 * every number is checked finite and bounded, every string is length-capped. A frame that fails is
 * ignored rather than answered — the socket is not a place to teach a caller the parser's rules.
 *
 * Pure: no socket, no browser, no clock. Both ends and their tests import it as plain values.
 */

/** CDP's modifier bitmask: Alt 1, Control 2, Meta 4, Shift 8. The page builds it; the browser reads it. */
export const MODIFIER_ALT = 1;
export const MODIFIER_CONTROL = 2;
export const MODIFIER_META = 4;
export const MODIFIER_SHIFT = 8;
const MODIFIER_MASK = MODIFIER_ALT | MODIFIER_CONTROL | MODIFIER_META | MODIFIER_SHIFT;

/*
 * The remote screen's size bounds. The page asks for the size of the space it has; the Worker holds
 * the answer inside these, because a viewport is memory and pixels on the remote browser and every
 * frame's size, and a caller choosing 20000 by 20000 would be choosing the bill.
 */
export const LIVE_VIEWPORT_MINIMUM = { width: 320, height: 240 } as const;
export const LIVE_VIEWPORT_MAXIMUM = { width: 1920, height: 1600 } as const;
export const LIVE_VIEWPORT_DEFAULT = { width: 1280, height: 800 } as const;

/** The longest paste the stream carries. Enough for any form field; not enough to be a payload. */
export const MAXIMUM_INSERTED_TEXT = 10_000;
const MAXIMUM_ADDRESS = 2048;
const MAXIMUM_KEY_NAME = 32;

export interface LiveViewport {
  readonly width: number;
  readonly height: number;
}

export type PointerButton = "none" | "left" | "middle" | "right";

export type LiveClientMessage =
  | { readonly type: "navigate"; readonly url: string }
  | { readonly type: "history"; readonly direction: "back" | "forward" }
  | { readonly type: "reload" }
  | {
      readonly type: "pointer";
      readonly action: "move" | "down" | "up";
      readonly x: number;
      readonly y: number;
      readonly button: PointerButton;
      readonly clickCount: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "wheel";
      readonly x: number;
      readonly y: number;
      readonly deltaX: number;
      readonly deltaY: number;
      readonly modifiers: number;
    }
  | {
      readonly type: "key";
      readonly action: "down" | "up";
      readonly key: string;
      readonly code: string;
      readonly modifiers: number;
    }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "viewport"; readonly width: number; readonly height: number }
  /** The page has drawn the last frame it was sent and can take another. */
  | { readonly type: "frameAck" }
  /** Send the full view of the page as it stands now, screenshot included — for the download. */
  | { readonly type: "capture" }
  | { readonly type: "ping" };

/** The inspector's facts about the page on show — the static capture's view shape, field for field. */
export interface LiveView {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly redirectChain: readonly { url: string; status: number; location?: string }[];
  readonly responseHeaders: Readonly<Record<string, string>>;
  /** Empty on the automatic details frame; a full-page PNG on a capture the member asked for. */
  readonly screenshotBase64: string;
  readonly title?: string;
  readonly markdown?: string;
  readonly links: readonly string[];
}

/** Why a stream ended, each of which the page words differently. */
export type LiveEndReason =
  /** Nobody touched the remote browser for the idle window. */
  | "idle"
  /** The session reached its total-life ceiling. */
  | "ceiling"
  /** The member opened Live somewhere else; one member holds one stream. */
  | "replaced"
  /** The member, or the page leaving, ended it. */
  | "closed"
  /** The remote browser could not be reached, or went away. */
  | "failed";

export type LiveServerMessage =
  | {
      readonly type: "ready";
      /** False when this stream started a fresh browser — the cookies of any earlier session are gone. */
      readonly sessionContinued: boolean;
      readonly viewport: LiveViewport;
    }
  | {
      readonly type: "frame";
      /** Base64 JPEG of the remote screen. */
      readonly data: string;
      /** The coordinate space pointer input is expressed in: the remote viewport, in CSS pixels. */
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly type: "location";
      readonly url: string;
      readonly title?: string;
      readonly canGoBack: boolean;
      readonly canGoForward: boolean;
    }
  | { readonly type: "loading"; readonly loading: boolean }
  | {
      readonly type: "details";
      readonly view: LiveView;
      /** From the navigation starting to the page's load event, when the Worker saw both. */
      readonly elapsedMilliseconds: number | null;
    }
  | { readonly type: "capture"; readonly view: LiveView }
  /** A navigation the address guard refused. Never carries the address: the member knows what they asked for. */
  | { readonly type: "refused" }
  /** The page raised an alert, confirm or prompt; the Worker dismissed it so the page does not hang. */
  | { readonly type: "dialog"; readonly kind: string; readonly message: string }
  /** A navigation or capture did not complete. Stated in the Worker's words, never the upstream's. */
  | { readonly type: "failed"; readonly action: "navigate" | "capture" }
  | {
      readonly type: "ended";
      readonly reason: LiveEndReason;
      /** On `failed`: the Error ID the Worker recorded the failure under, for the member to quote. */
      readonly errorId?: string;
    }
  | { readonly type: "pong" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteBetween(value: unknown, minimum: number, maximum: number): value is number {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function boundedString(value: unknown, minimum: number, maximum: number): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum;
}

function modifiersOf(value: unknown): number | null {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || (value as number) < 0) return null;
  return (value as number) & MODIFIER_MASK;
}

// Coordinates are bounded by the largest viewport the Worker would ever hold, then clamped to the
// one it actually holds when the input is dispatched.
const COORDINATE_LIMIT = Math.max(LIVE_VIEWPORT_MAXIMUM.width, LIVE_VIEWPORT_MAXIMUM.height);
// A wheel delta beyond this is not a scroll anybody made with a wheel.
const WHEEL_LIMIT = 10_000;

/**
 * One frame from the member's page, as a message the Worker may act on — or null when it is not
 * one. Takes the raw frame so the caller never parses JSON itself.
 */
export function parseLiveClientMessage(raw: unknown): LiveClientMessage | null {
  if (typeof raw !== "string" || raw.length > MAXIMUM_INSERTED_TEXT * 2) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  switch (value["type"]) {
    case "navigate":
      return boundedString(value["url"], 1, MAXIMUM_ADDRESS)
        ? { type: "navigate", url: value["url"] }
        : null;
    case "history":
      return value["direction"] === "back" || value["direction"] === "forward"
        ? { type: "history", direction: value["direction"] }
        : null;
    case "reload":
    case "frameAck":
    case "capture":
    case "ping":
      return { type: value["type"] };
    case "pointer": {
      const action = value["action"];
      const button = value["button"] ?? "none";
      const clickCount = value["clickCount"] ?? 0;
      const modifiers = modifiersOf(value["modifiers"]);
      if (action !== "move" && action !== "down" && action !== "up") return null;
      if (button !== "none" && button !== "left" && button !== "middle" && button !== "right") {
        return null;
      }
      if (!finiteBetween(value["x"], 0, COORDINATE_LIMIT)) return null;
      if (!finiteBetween(value["y"], 0, COORDINATE_LIMIT)) return null;
      if (!Number.isInteger(clickCount) || !finiteBetween(clickCount, 0, 3)) return null;
      if (modifiers === null) return null;
      return {
        type: "pointer",
        action,
        x: value["x"],
        y: value["y"],
        button,
        clickCount,
        modifiers,
      };
    }
    case "wheel": {
      const modifiers = modifiersOf(value["modifiers"]);
      if (!finiteBetween(value["x"], 0, COORDINATE_LIMIT)) return null;
      if (!finiteBetween(value["y"], 0, COORDINATE_LIMIT)) return null;
      if (!finiteBetween(value["deltaX"], -WHEEL_LIMIT, WHEEL_LIMIT)) return null;
      if (!finiteBetween(value["deltaY"], -WHEEL_LIMIT, WHEEL_LIMIT)) return null;
      if (modifiers === null) return null;
      return {
        type: "wheel",
        x: value["x"],
        y: value["y"],
        deltaX: value["deltaX"],
        deltaY: value["deltaY"],
        modifiers,
      };
    }
    case "key": {
      const action = value["action"];
      const modifiers = modifiersOf(value["modifiers"]);
      if (action !== "down" && action !== "up") return null;
      if (!boundedString(value["key"], 1, MAXIMUM_KEY_NAME)) return null;
      const code = value["code"] ?? "";
      if (!boundedString(code, 0, MAXIMUM_KEY_NAME)) return null;
      if (modifiers === null) return null;
      return { type: "key", action, key: value["key"], code, modifiers };
    }
    case "text":
      return boundedString(value["text"], 1, MAXIMUM_INSERTED_TEXT)
        ? { type: "text", text: value["text"] }
        : null;
    case "viewport":
      return finiteBetween(value["width"], 1, COORDINATE_LIMIT * 4) &&
        finiteBetween(value["height"], 1, COORDINATE_LIMIT * 4)
        ? { type: "viewport", width: value["width"], height: value["height"] }
        : null;
    default:
      return null;
  }
}

/** The viewport the Worker will actually hold for a requested size: whole pixels, inside the bounds. */
export function clampViewport(requested: LiveViewport): LiveViewport {
  const clamp = (value: number, minimum: number, maximum: number) =>
    Math.min(maximum, Math.max(minimum, Math.round(value)));
  return {
    width: clamp(requested.width, LIVE_VIEWPORT_MINIMUM.width, LIVE_VIEWPORT_MAXIMUM.width),
    height: clamp(requested.height, LIVE_VIEWPORT_MINIMUM.height, LIVE_VIEWPORT_MAXIMUM.height),
  };
}

/** A pointer position held inside the viewport it is dispatched into. */
export function clampToViewport(
  point: { x: number; y: number },
  viewport: LiveViewport,
): { x: number; y: number } {
  return {
    x: Math.min(viewport.width - 1, Math.max(0, point.x)),
    y: Math.min(viewport.height - 1, Math.max(0, point.y)),
  };
}

/**
 * The page's side of the parse: one frame from the Worker, or null. Looser than the Worker's parse
 * — the Worker is this deployment, not a stranger — but still checked, so a malformed frame is
 * dropped rather than crashing the screen that draws it.
 */
export function parseLiveServerMessage(raw: unknown): LiveServerMessage | null {
  if (typeof raw !== "string") return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value["type"] !== "string") return null;
  switch (value["type"]) {
    case "frame":
      return typeof value["data"] === "string" &&
        finiteBetween(value["width"], 1, COORDINATE_LIMIT) &&
        finiteBetween(value["height"], 1, COORDINATE_LIMIT)
        ? (value as LiveServerMessage)
        : null;
    case "location":
      return typeof value["url"] === "string" ? (value as LiveServerMessage) : null;
    case "details":
    case "capture":
      return isRecord(value["view"]) && typeof value["view"]["finalUrl"] === "string"
        ? (value as LiveServerMessage)
        : null;
    case "ready":
    case "loading":
    case "refused":
    case "dialog":
    case "failed":
    case "ended":
    case "pong":
      return value as LiveServerMessage;
    default:
      return null;
  }
}
