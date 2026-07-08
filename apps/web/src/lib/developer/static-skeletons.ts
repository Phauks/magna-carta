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

export function applyStaticSkeletons(on: boolean): void {
  if (typeof document !== "undefined") {
    document.documentElement.toggleAttribute(ROOT_ATTRIBUTE, on);
  }
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
