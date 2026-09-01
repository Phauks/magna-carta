import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { folderPickerSupported, saveToTarget } from "$lib/export/save-target.ts";

/*
 * The property that matters most here is NEGATIVE: a folder is a convenience and the file is the
 * point, so no state of the picker, the permission, or the folder itself may cost a member their
 * download. Each case below drives one failure and asserts the ordinary download still ran.
 */

interface AnchorSpy {
  clicks: number;
  lastDownload: string;
}

// The web suite runs in the node environment, so the handful of browser globals this path touches
// are supplied here rather than by switching every web test to a DOM environment for one file.
function stubAnchor(): AnchorSpy {
  const spy: AnchorSpy = { clicks: 0, lastDownload: "" };
  const anchor = {
    href: "",
    download: "",
    click() {
      spy.clicks += 1;
      spy.lastDownload = anchor.download;
    },
  };
  (globalThis as Record<string, unknown>)["document"] = {
    createElement: () => anchor,
  };
  globalThis.URL.createObjectURL = vi.fn(() => "blob:stub");
  globalThis.URL.revokeObjectURL = vi.fn();
  return spy;
}

const realIndexedDatabase = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");

// Globals stubbed here must not outlive the file: a leaked throwing `indexedDB` would surface as a
// failure in some other suite that never touched it.
afterEach(() => {
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "document");
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "showDirectoryPicker");
  if (realIndexedDatabase === undefined) {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, "indexedDB");
  } else {
    Object.defineProperty(globalThis, "indexedDB", realIndexedDatabase);
  }
});

beforeEach(() => {
  vi.restoreAllMocks();
  // No IndexedDB in the test environment, which is also a real browser state (a private window, or
  // site data blocked) — the download must survive it.
  Reflect.deleteProperty(globalThis as Record<string, unknown>, "showDirectoryPicker");
});

describe("folderPickerSupported", () => {
  it("is false where the browser exposes no directory picker", () => {
    expect(folderPickerSupported()).toBe(false);
  });

  it("is true only where the browser really exposes one", () => {
    (globalThis as Record<string, unknown>)["showDirectoryPicker"] = () => Promise.resolve({});
    expect(folderPickerSupported()).toBe(true);
  });
});

describe("saveToTarget", () => {
  it("falls back to the browser download when no folder is chosen", async () => {
    const anchor = stubAnchor();
    const where = await saveToTarget("a,b\n1,2", "Firm Usage.csv", "text/csv");
    expect(where).toBe("browser");
    expect(anchor.clicks).toBe(1);
    expect(anchor.lastDownload).toBe("Firm Usage.csv");
  });

  it("still saves when storage is unavailable entirely", async () => {
    const anchor = stubAnchor();
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("site data blocked");
      },
    });
    const where = await saveToTarget(new Blob(["x"]), "Report.xlsx", "application/octet-stream");
    expect(where).toBe("browser");
    expect(anchor.clicks).toBe(1);
  });
});
