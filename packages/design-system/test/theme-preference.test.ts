// @vitest-environment happy-dom
/*
 * The happy-dom environment (per-file pragma — the rest of the package runs in the default node
 * pool) provides document + localStorage; matchMedia is stubbed per test so the
 * prefers-color-scheme branch is deterministic rather than dependent on happy-dom's device
 * emulation defaults.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyThemePreference,
  DEFAULT_THEME,
  readThemePreference,
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
  document.documentElement.classList.remove("dark");
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readThemePreference", () => {
  it("defaults to the flagship theme and system mode when nothing is stored", () => {
    expect(readThemePreference()).toEqual({ theme: DEFAULT_THEME, mode: "system" });
  });

  it("returns the stored theme and mode", () => {
    localStorage.setItem("magna-carta.theme", "midnight");
    localStorage.setItem("magna-carta.mode", "dark");
    expect(readThemePreference()).toEqual({ theme: "midnight", mode: "dark" });
  });

  it("falls back to system mode when the stored mode is not a recognized Mode", () => {
    localStorage.setItem("magna-carta.mode", "blue");
    expect(readThemePreference().mode).toBe("system");
  });
});

describe("applyThemePreference", () => {
  it("persists both storage keys", () => {
    applyThemePreference("slate", "light");
    expect(localStorage.getItem("magna-carta.theme")).toBe("slate");
    expect(localStorage.getItem("magna-carta.mode")).toBe("light");
  });

  it("sets data-theme on the document element", () => {
    applyThemePreference("midnight", "light");
    expect(document.documentElement.dataset.theme).toBe("midnight");
  });

  it("adds the dark class for mode dark and removes it for mode light", () => {
    applyThemePreference("slate", "dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyThemePreference("slate", "light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores the operating-system preference for explicit light/dark modes", () => {
    stubMatchMedia(true); // operating system prefers dark
    applyThemePreference("slate", "light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("resolves system mode via prefers-color-scheme: dark", () => {
    const matchMediaStub = stubMatchMedia(true);
    applyThemePreference("slate", "system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(matchMediaStub).toHaveBeenCalledWith("(prefers-color-scheme: dark)");

    stubMatchMedia(false);
    applyThemePreference("slate", "system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("round-trips through readThemePreference", () => {
    const mode: Mode = "dark";
    applyThemePreference("midnight", mode);
    expect(readThemePreference()).toEqual({ theme: "midnight", mode });
  });
});
