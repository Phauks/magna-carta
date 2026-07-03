/*
 * The platform predicates are pure over the platform string, so the Apple and non-Apple branches
 * are both provable without spoofing a browser — the owner's verification ask (2026-07-02): the
 * palette chord shown in the top bar must follow the OS, never a hardcoded label.
 */
import { describe, expect, it } from "vitest";
import {
  isApplePlatform,
  isPaletteChord,
  paletteShortcutLabel,
} from "../src/lib/internal/platform.ts";

describe("isApplePlatform", () => {
  it.each(["MacIntel", "macOS", "iPhone", "iPad", "iPod touch"])("true for %s", (platform) => {
    expect(isApplePlatform(platform)).toBe(true);
  });

  it.each(["Win32", "Windows", "Linux x86_64", "Android", "Chrome OS", ""])(
    "false for %s",
    (platform) => {
      expect(isApplePlatform(platform)).toBe(false);
    },
  );
});

describe("paletteShortcutLabel", () => {
  it("writes the chord the way the OS writes it", () => {
    expect(paletteShortcutLabel("MacIntel")).toBe("⌘K");
    expect(paletteShortcutLabel("Win32")).toBe("Ctrl K");
    expect(paletteShortcutLabel("Linux x86_64")).toBe("Ctrl K");
  });
});

describe("isPaletteChord", () => {
  it("matches Cmd+K on Apple platforms and ignores Ctrl+K there", () => {
    expect(isPaletteChord({ key: "k", metaKey: true, ctrlKey: false }, "MacIntel")).toBe(true);
    expect(isPaletteChord({ key: "K", metaKey: true, ctrlKey: false }, "MacIntel")).toBe(true);
    expect(isPaletteChord({ key: "k", metaKey: false, ctrlKey: true }, "MacIntel")).toBe(false);
  });

  it("matches Ctrl+K elsewhere and ignores the bare key", () => {
    expect(isPaletteChord({ key: "k", metaKey: false, ctrlKey: true }, "Win32")).toBe(true);
    expect(isPaletteChord({ key: "k", metaKey: false, ctrlKey: false }, "Win32")).toBe(false);
    expect(isPaletteChord({ key: "j", metaKey: false, ctrlKey: true }, "Win32")).toBe(false);
  });
});
