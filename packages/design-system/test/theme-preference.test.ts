// @vitest-environment happy-dom
/*
 * The happy-dom environment (per-file pragma — the rest of the package runs in the default node
 * pool) provides document + localStorage; matchMedia is stubbed per test so the
 * prefers-color-scheme branch is deterministic rather than dependent on happy-dom's device
 * emulation defaults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyContrastToDocument,
  applyDensityToDocument,
  applyMotionToDocument,
  applyScrollEdgeHintsToDocument,
  applyTextSizeToDocument,
  applyThemePreference,
  applyThemeToDocument,
  applyTypefaceToDocument,
  CONTRAST_STORAGE_KEY,
  DEFAULT_THEME,
  DENSITY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MOTION_STORAGE_KEY,
  readThemePreference,
  SCROLL_EDGE_HINTS_STORAGE_KEY,
  TEXT_SIZE_STORAGE_KEY,
  THEME_STORAGE_KEY,
  TYPEFACE_STORAGE_KEY,
  type Mode,
} from "../src/lib/internal/theme-preference.ts";

function stubMatchMedia(matches: boolean): ReturnType<typeof vi.fn> {
  const matchMediaStub = vi.fn((query: string) => ({ matches, media: query }));
  vi.stubGlobal("matchMedia", matchMediaStub);
  return matchMediaStub;
}

// Node 25 ships a built-in global `localStorage` (Web Storage) that is disabled without
// --localstorage-file and that happy-dom's global registrator cannot replace, so the
// environment's own implementation never reaches the global scope the module reads. The storage
// side of the seam is therefore stubbed in-memory per test; happy-dom still provides the DOM the
// tests actually exercise (document.documentElement dataset + classList).
function stubLocalStorage(): void {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    clear: () => entries.clear(),
  });
}

beforeEach(() => {
  stubLocalStorage();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-motion");
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-contrast");
  document.documentElement.removeAttribute("data-scroll-edge-hints");
  document.documentElement.removeAttribute("data-typeface");
  document.documentElement.style.fontSize = "";
  document.documentElement.classList.remove("dark");
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readThemePreference", () => {
  it("defaults to flagship theme, system mode/motion/contrast, comfortable density when nothing is stored", () => {
    // Contrast defaults to "system" — the seed-then-own contract: unset follows the OS signal.
    expect(readThemePreference()).toEqual({
      theme: DEFAULT_THEME,
      mode: "system",
      motion: "system",
      density: "comfortable",
      contrast: "system",
      scrollEdgeHints: "shown",
      typeface: "inter",
      textSize: 100,
    });
  });

  it("returns the stored theme, mode, motion, and density", () => {
    localStorage.setItem("magna-carta.theme", "midnight");
    localStorage.setItem("magna-carta.mode", "dark");
    localStorage.setItem("magna-carta.motion", "reduced");
    localStorage.setItem("magna-carta.density", "compact");
    localStorage.setItem("magna-carta.contrast", "high");
    localStorage.setItem("magna-carta.scrollEdgeHints", "hidden");
    localStorage.setItem("magna-carta.typeface", "opendyslexic");
    localStorage.setItem("magna-carta.textSize", "125");
    expect(readThemePreference()).toEqual({
      theme: "midnight",
      mode: "dark",
      motion: "reduced",
      density: "compact",
      contrast: "high",
      scrollEdgeHints: "hidden",
      typeface: "opendyslexic",
      textSize: 125,
    });
  });

  it("falls back to system mode when the stored mode is not a recognized Mode", () => {
    localStorage.setItem("magna-carta.mode", "blue");
    expect(readThemePreference().mode).toBe("system");
  });

  it("falls back to system motion when the stored motion is not recognized", () => {
    localStorage.setItem("magna-carta.motion", "lots");
    expect(readThemePreference().motion).toBe("system");
  });

  it("falls back to comfortable density when the stored density is not recognized", () => {
    localStorage.setItem("magna-carta.density", "cozy");
    expect(readThemePreference().density).toBe("comfortable");
  });

  it("falls back to system contrast (the unset seed) when the stored contrast is not recognized", () => {
    localStorage.setItem("magna-carta.contrast", "extra");
    expect(readThemePreference().contrast).toBe("system");
  });

  it("falls back to shown when the stored scroll-edge-hint preference is not recognized", () => {
    localStorage.setItem(SCROLL_EDGE_HINTS_STORAGE_KEY, "sometimes");
    expect(readThemePreference().scrollEdgeHints).toBe("shown");
  });

  it("falls back to the Inter reading face when the stored typeface is not recognized", () => {
    localStorage.setItem(TYPEFACE_STORAGE_KEY, "comic-sans");
    expect(readThemePreference().typeface).toBe("inter");
  });

  it("reads the old Atkinson default as the Inter default, not as a choice of Atkinson", () => {
    localStorage.setItem(TYPEFACE_STORAGE_KEY, "atkinson");
    expect(readThemePreference().typeface).toBe("inter");
    localStorage.setItem(TYPEFACE_STORAGE_KEY, "atkinson-hyperlegible");
    expect(readThemePreference().typeface).toBe("atkinson-hyperlegible");
  });

  it("falls back to the default text size when the stored size is not recognized", () => {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "enormous");
    expect(readThemePreference().textSize).toBe(100);
  });

  it.each(["49", "201", "12.5", "-80", ""])(
    "falls back to 100%% when the stored size %j is outside 50 to 200 or not whole",
    (stored) => {
      localStorage.setItem(TEXT_SIZE_STORAGE_KEY, stored);
      expect(readThemePreference().textSize).toBe(100);
    },
  );

  it.each([50, 200])("accepts the bound %i", (bound) => {
    localStorage.setItem(TEXT_SIZE_STORAGE_KEY, String(bound));
    expect(readThemePreference().textSize).toBe(bound);
  });
});

describe("applyTextSizeToDocument", () => {
  it.each([50, 90, 125, 200])("sets the root font size to %i%%", (textSize) => {
    applyTextSizeToDocument(textSize);
    expect(document.documentElement.style.fontSize).toBe(`${textSize}%`);
  });

  it("clears the root font size at 100%, the browser's own size", () => {
    applyTextSizeToDocument(150);
    applyTextSizeToDocument(100);
    expect(document.documentElement.style.fontSize).toBe("");
  });

  it("persists nothing", () => {
    applyTextSizeToDocument(110);
    expect(localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBeNull();
  });
});

describe("applyTypefaceToDocument", () => {
  it.each(["lexend", "opendyslexic", "serif", "system"] as const)(
    "sets data-typeface for %s",
    (typeface) => {
      applyTypefaceToDocument(typeface);
      expect(document.documentElement.dataset.typeface).toBe(typeface);
    },
  );

  it("removes data-typeface for the Inter default, which needs no overlay", () => {
    applyTypefaceToDocument("lexend");
    applyTypefaceToDocument("inter");
    expect(document.documentElement.dataset.typeface).toBeUndefined();
  });

  it("persists nothing", () => {
    applyTypefaceToDocument("serif");
    expect(localStorage.getItem(TYPEFACE_STORAGE_KEY)).toBeNull();
  });
});

describe("applyScrollEdgeHintsToDocument", () => {
  it("sets data-scroll-edge-hints for hidden and removes it for shown", () => {
    applyScrollEdgeHintsToDocument("hidden");
    expect(document.documentElement.dataset.scrollEdgeHints).toBe("hidden");
    applyScrollEdgeHintsToDocument("shown");
    expect(document.documentElement.dataset.scrollEdgeHints).toBeUndefined();
  });

  it("does not consult the operating system: there is no signal for it to seed from", () => {
    const matchMediaStub = stubMatchMedia(true);
    applyScrollEdgeHintsToDocument("shown");
    expect(matchMediaStub).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.scrollEdgeHints).toBeUndefined();
  });
});

describe("applyContrastToDocument", () => {
  it("sets data-contrast for high and removes it for standard", () => {
    applyContrastToDocument("high");
    expect(document.documentElement.dataset.contrast).toBe("high");
    applyContrastToDocument("standard");
    expect(document.documentElement.dataset.contrast).toBeUndefined();
  });

  it("resolves system contrast via prefers-contrast: more", () => {
    const matchMediaStub = stubMatchMedia(true); // operating system asks for more contrast
    applyContrastToDocument("system");
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(matchMediaStub).toHaveBeenCalledWith("(prefers-contrast: more)");

    stubMatchMedia(false);
    applyContrastToDocument("system");
    expect(document.documentElement.dataset.contrast).toBeUndefined();
  });

  it("persists NOTHING — the pure DOM seam", () => {
    applyContrastToDocument("high");
    expect(localStorage.getItem(CONTRAST_STORAGE_KEY)).toBeNull();
  });
});

describe("applyDensityToDocument", () => {
  it("sets data-density for compact and removes it for comfortable", () => {
    applyDensityToDocument("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
    applyDensityToDocument("comfortable");
    expect(document.documentElement.dataset.density).toBeUndefined();
  });

  it("persists NOTHING — the pure DOM seam", () => {
    applyDensityToDocument("compact");
    expect(localStorage.getItem(DENSITY_STORAGE_KEY)).toBeNull();
  });
});

describe("applyMotionToDocument", () => {
  it("sets data-motion for explicit reduced/off and removes it for full", () => {
    applyMotionToDocument("reduced");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    applyMotionToDocument("off");
    expect(document.documentElement.dataset.motion).toBe("off");
    applyMotionToDocument("full");
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  it("resolves system motion via prefers-reduced-motion", () => {
    const matchMediaStub = stubMatchMedia(true); // operating system prefers reduced motion
    applyMotionToDocument("system");
    expect(document.documentElement.dataset.motion).toBe("reduced");
    expect(matchMediaStub).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");

    stubMatchMedia(false);
    applyMotionToDocument("system");
    expect(document.documentElement.dataset.motion).toBeUndefined();
  });

  it("persists NOTHING — the pure DOM seam", () => {
    applyMotionToDocument("off");
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
  });
});

describe("applyThemeToDocument", () => {
  it("sets data-theme on the document element", () => {
    applyThemeToDocument("midnight", "light");
    expect(document.documentElement.dataset.theme).toBe("midnight");
  });

  it("adds the dark class for mode dark and removes it for mode light", () => {
    applyThemeToDocument("slate", "dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyThemeToDocument("slate", "light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores the operating-system preference for explicit light/dark modes", () => {
    stubMatchMedia(true); // operating system prefers dark
    applyThemeToDocument("slate", "light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolves system mode via prefers-color-scheme: dark", () => {
    const matchMediaStub = stubMatchMedia(true);
    applyThemeToDocument("slate", "system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(matchMediaStub).toHaveBeenCalledWith("(prefers-color-scheme: dark)");

    stubMatchMedia(false);
    applyThemeToDocument("slate", "system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  // color-scheme decides what the BROWSER paints — the canvas, native scrollbars, form controls.
  // styles/base.css declares it on this same class; this write is the one that lands before any
  // stylesheet has arrived, so the two must never be able to disagree.
  it("moves color-scheme with the dark class, in both directions", () => {
    applyThemeToDocument("slate", "dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    applyThemeToDocument("slate", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("resolves color-scheme from the operating system in system mode", () => {
    stubMatchMedia(true);
    applyThemeToDocument("slate", "system");
    expect(document.documentElement.style.colorScheme).toBe("dark");

    stubMatchMedia(false);
    applyThemeToDocument("slate", "system");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("persists NOTHING — the pure DOM seam the Storybook toolbar relies on", () => {
    applyThemeToDocument("midnight", "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
  });
});

describe("applyThemePreference", () => {
  it("persists all storage keys (the exported key constants are the stored literals)", () => {
    applyThemePreference(
      "slate",
      "light",
      "reduced",
      "comfortable",
      "high",
      "hidden",
      "lexend",
      110,
    );
    expect(TEXT_SIZE_STORAGE_KEY).toBe("magna-carta.textSize");
    expect(localStorage.getItem("magna-carta.textSize")).toBe("110");
    expect(TYPEFACE_STORAGE_KEY).toBe("magna-carta.typeface");
    expect(localStorage.getItem("magna-carta.typeface")).toBe("lexend");
    expect(THEME_STORAGE_KEY).toBe("magna-carta.theme");
    expect(MODE_STORAGE_KEY).toBe("magna-carta.mode");
    expect(MOTION_STORAGE_KEY).toBe("magna-carta.motion");
    expect(CONTRAST_STORAGE_KEY).toBe("magna-carta.contrast");
    expect(SCROLL_EDGE_HINTS_STORAGE_KEY).toBe("magna-carta.scrollEdgeHints");
    expect(localStorage.getItem("magna-carta.theme")).toBe("slate");
    expect(localStorage.getItem("magna-carta.mode")).toBe("light");
    expect(localStorage.getItem("magna-carta.motion")).toBe("reduced");
    expect(localStorage.getItem("magna-carta.contrast")).toBe("high");
    expect(localStorage.getItem("magna-carta.scrollEdgeHints")).toBe("hidden");
  });

  it("applies the theme, mode, motion, contrast, scroll-edge-hint and typeface choice to the document", () => {
    applyThemePreference("midnight", "dark", "off", "comfortable", "high", "hidden", "serif", 150);
    expect(document.documentElement.dataset.typeface).toBe("serif");
    expect(document.documentElement.style.fontSize).toBe("150%");
    expect(document.documentElement.dataset.theme).toBe("midnight");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.motion).toBe("off");
    expect(document.documentElement.dataset.contrast).toBe("high");
    expect(document.documentElement.dataset.scrollEdgeHints).toBe("hidden");
  });

  it("round-trips through readThemePreference", () => {
    const mode: Mode = "dark";
    applyThemePreference("midnight", mode, "full", "compact", "high", "hidden", "system", 80);
    expect(readThemePreference()).toEqual({
      theme: "midnight",
      mode,
      motion: "full",
      density: "compact",
      contrast: "high",
      scrollEdgeHints: "hidden",
      typeface: "system",
      textSize: 80,
    });
  });
});
