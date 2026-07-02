// @vitest-environment happy-dom
/*
 * The happy-dom environment (per-file pragma — the rest of the package runs in the default node
 * pool) provides document + localStorage; matchMedia is stubbed per test so the
 * prefers-color-scheme branch is deterministic rather than dependent on happy-dom's device
 * emulation defaults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyDensityToDocument,
  applyMotionToDocument,
  applyThemePreference,
  applyThemeToDocument,
  DEFAULT_THEME,
  DENSITY_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MOTION_STORAGE_KEY,
  readThemePreference,
  THEME_STORAGE_KEY,
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
  document.documentElement.classList.remove("dark");
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readThemePreference", () => {
  it("defaults to flagship theme, system mode/motion, comfortable density when nothing is stored", () => {
    expect(readThemePreference()).toEqual({
      theme: DEFAULT_THEME,
      mode: "system",
      motion: "system",
      density: "comfortable",
    });
  });

  it("returns the stored theme, mode, motion, and density", () => {
    localStorage.setItem("magna-carta.theme", "midnight");
    localStorage.setItem("magna-carta.mode", "dark");
    localStorage.setItem("magna-carta.motion", "reduced");
    localStorage.setItem("magna-carta.density", "compact");
    expect(readThemePreference()).toEqual({
      theme: "midnight",
      mode: "dark",
      motion: "reduced",
      density: "compact",
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

  it("persists NOTHING — the pure DOM seam the Storybook toolbar relies on", () => {
    applyThemeToDocument("midnight", "dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
  });
});

describe("applyThemePreference", () => {
  it("persists all storage keys (the exported key constants are the stored literals)", () => {
    applyThemePreference("slate", "light", "reduced");
    expect(THEME_STORAGE_KEY).toBe("magna-carta.theme");
    expect(MODE_STORAGE_KEY).toBe("magna-carta.mode");
    expect(MOTION_STORAGE_KEY).toBe("magna-carta.motion");
    expect(localStorage.getItem("magna-carta.theme")).toBe("slate");
    expect(localStorage.getItem("magna-carta.mode")).toBe("light");
    expect(localStorage.getItem("magna-carta.motion")).toBe("reduced");
  });

  it("applies the theme, mode, and motion to the document", () => {
    applyThemePreference("midnight", "dark", "off");
    expect(document.documentElement.dataset.theme).toBe("midnight");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.motion).toBe("off");
  });

  it("round-trips through readThemePreference", () => {
    const mode: Mode = "dark";
    applyThemePreference("midnight", mode, "full", "compact");
    expect(readThemePreference()).toEqual({
      theme: "midnight",
      mode,
      motion: "full",
      density: "compact",
    });
  });
});
