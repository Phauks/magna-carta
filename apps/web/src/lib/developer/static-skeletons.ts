/*
 * The "static loading placeholders" developer preference: freeze the skeleton pulse app-wide by
 * setting a root data attribute the design-system skeleton recipe honours (its skeleton.css). A
 * dev-only convenience — a placeholder that will never resolve (a "Soon" seam) shouldn't shimmer
 * as if it were about to load — persisted per browser. Kept standalone (not the console-storage
 * helper) so the app shell can apply it at boot, before the developer console is ever opened.
 */
const STORAGE_KEY = "mc-developer-static-skeletons";
const ROOT_ATTRIBUTE = "data-mc-static-skeletons";

export function readStaticSkeletons(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Set (or clear) the attribute on this window's document — the live effect, no persistence. */
function applyToDocument(on: boolean): void {
  if (typeof document !== "undefined") {
    document.documentElement.toggleAttribute(ROOT_ATTRIBUTE, on);
  }
}

export function applyStaticSkeletons(on: boolean): void {
  applyToDocument(on);
  try {
    if (on) {
      localStorage.setItem(STORAGE_KEY, "true");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage unavailable (private mode, quota); the live attribute still applies for the session.
  }
}

/*
 * CROSS-WINDOW FOLLOW (mirrors the appearance cross-tab follow in theme-preference.ts): the browser
 * fires "storage" in every OTHER same-origin window when the key changes, so toggling this in the
 * popped-out console re-applies it here — the console drives the main window. The re-apply is
 * DOM-only (no persist), so it cannot ping-pong with the window that wrote. Registered once at
 * module scope, guarded for SSR/tests where `window` is absent; `event.key === null` is
 * `storage.clear()`, so re-apply then too.
 */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    applyToDocument(readStaticSkeletons());
  });
}
