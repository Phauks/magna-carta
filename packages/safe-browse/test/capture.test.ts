import { expect, test } from "vitest";
import { captureSafeView } from "../src/capture.ts";
import type { SafeBrowseDeps } from "../src/types.ts";

function deps(): SafeBrowseDeps {
  return {
    probe: {
      async follow(url) {
        return {
          chain: [{ url, status: 301, location: "https://final.example/" }],
          finalUrl: "https://final.example/",
          headers: { "content-type": "text/html" },
        };
      },
    },
    renderer: {
      async snapshot() {
        return {
          screenshotBase64: "aGVsbG8=",
          markdown: "# Hi",
          title: "Hi",
          links: ["https://x.example/"],
        };
      },
    },
  };
}

test("rejects a private target before any render", async () => {
  const calls: string[] = [];
  const d = deps();
  d.renderer.snapshot = async () => {
    calls.push("rendered");
    return { screenshotBase64: "" };
  };
  await expect(captureSafeView("http://10.0.0.1/", d)).rejects.toMatchObject({
    name: "SsrfRejection",
  });
  expect(calls).toEqual([]); // never rendered
});

test("assembles a SafeView from probe + render", async () => {
  const view = await captureSafeView("http://start.example/", deps());
  expect(view.finalUrl).toBe("https://final.example/");
  expect(view.redirectChain).toHaveLength(1);
  expect(view.screenshotBase64).toBe("aGVsbG8=");
  expect(view.links).toEqual(["https://x.example/"]);
  expect(view.title).toBe("Hi");
});

test("reports probing then probed with the chain facts while the render is still due", async () => {
  const stages: Array<{ stage: string; redirectCount?: number; finalUrl?: string }> = [];
  await captureSafeView("http://start.example/", deps(), (stage) => stages.push(stage));
  expect(stages[0]).toEqual({ stage: "probing" });
  expect(stages[1]).toEqual({
    stage: "probed",
    redirectCount: 1,
    finalUrl: "https://final.example/",
  });
});

test("a throwing stage listener never fails the capture", async () => {
  const view = await captureSafeView("http://start.example/", deps(), () => {
    throw new Error("listener bug");
  });
  expect(view.screenshotBase64).toBe("aGVsbG8=");
});
