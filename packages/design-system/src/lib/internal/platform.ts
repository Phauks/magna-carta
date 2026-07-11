/*
 * Platform detection for keyboard affordances — the ONE place the Apple-vs-everyone question is
 * answered, so every keycap hint and chord listener agrees. Detection order: the modern
 * `navigator.userAgentData.platform`, then the legacy `navigator.platform` (deprecated but the
 * only signal on older engines), else empty (treated as non-Apple: Ctrl is the honest default).
 * The predicates take the platform STRING so they are pure and unit-testable; callers omit the
 * argument to use live detection.
 */

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: { platform?: string };
}

/** The platform string from the richest available source; "" outside a browser. */
export function detectedPlatform(): string {
  if (typeof navigator === "undefined") return "";
  const withData = navigator as NavigatorWithUserAgentData;
  return withData.userAgentData?.platform ?? navigator.platform ?? "";
}

/** True for macOS / iOS / iPadOS — the platforms whose primary chord modifier is Command. */
export function isApplePlatform(platform: string = detectedPlatform()): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** The command-palette chord, written the way the OS writes it. */
export function paletteShortcutLabel(platform: string = detectedPlatform()): string {
  return isApplePlatform(platform) ? "⌘K" : "Ctrl K";
}

/** True when the event IS the palette chord on this platform (Cmd+K / Ctrl+K). */
export function isPaletteChord(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey">,
  platform: string = detectedPlatform(),
): boolean {
  if (event.key.toLowerCase() !== "k") return false;
  return isApplePlatform(platform) ? event.metaKey : event.ctrlKey;
}
