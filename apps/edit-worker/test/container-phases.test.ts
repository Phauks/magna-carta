import { describe, expect, it } from "vitest";
import {
  CONTAINER_STATUS_PATH,
  detailOf,
  hasPhase,
  isStatusRequest,
  MAX_CONTAINER_EVENTS,
  statusResponse,
  withEvent,
  type ContainerEvent,
} from "../src/container-phases.ts";

const at = (seconds: number): string => new Date(1_789_800_000_000 + seconds * 1000).toISOString();
const event = (phase: ContainerEvent["phase"], seconds: number, detail: string | null = null) => ({
  phase,
  at: at(seconds),
  detail,
});

describe("withEvent", () => {
  it("records a clean open as the five phases in order", () => {
    let events: readonly ContainerEvent[] = [];
    events = withEvent(events, event("requested", 0));
    events = withEvent(events, event("started", 0.3));
    events = withEvent(events, event("listening", 26.9));
    events = withEvent(events, event("served", 27.4));
    expect(events.map((entry) => entry.phase)).toEqual([
      "requested",
      "started",
      "listening",
      "served",
    ]);
  });

  it("does not record a request while the container is up, since the phase already happened", () => {
    const events = withEvent([event("requested", 0), event("started", 0.3)], event("requested", 5));
    expect(events).toHaveLength(2);
  });

  it("starts a fresh list on a request after the container stopped or failed", () => {
    const stopped = [event("requested", 0), event("started", 0.3), event("stopped", 400, "exit 0")];
    expect(withEvent(stopped, event("requested", 500))).toEqual([event("requested", 500)]);
    const failed = [event("requested", 0), event("error", 2, "could not start")];
    expect(withEvent(failed, event("requested", 3))).toEqual([event("requested", 3)]);
  });

  it("caps the list so a container that flaps cannot grow it without bound", () => {
    let events: readonly ContainerEvent[] = [event("requested", 0)];
    for (let index = 0; index < MAX_CONTAINER_EVENTS + 10; index += 1) {
      events = withEvent(events, event("started", index + 1));
    }
    expect(events).toHaveLength(MAX_CONTAINER_EVENTS);
    expect(events.at(-1)?.at).toBe(at(MAX_CONTAINER_EVENTS + 10));
  });
});

describe("hasPhase", () => {
  it("is true only for a phase on the current, unended list", () => {
    const live = [event("requested", 0), event("started", 0.3)];
    expect(hasPhase(live, "started")).toBe(true);
    expect(hasPhase(live, "listening")).toBe(false);
    expect(hasPhase([...live, event("stopped", 9)], "started")).toBe(false);
  });
});

describe("detailOf", () => {
  it("keeps an error's message, cut to size, and nothing for nothing", () => {
    expect(detailOf(new Error("container failed to start"))).toBe("container failed to start");
    expect(detailOf("  exit code 137  ")).toBe("exit code 137");
    expect(detailOf(null)).toBeNull();
    expect(detailOf("")).toBeNull();
    const long = detailOf("x".repeat(500));
    expect(long).toHaveLength(160);
    expect(long?.endsWith("…")).toBe(true);
  });
});

describe("the status read", () => {
  it("is a GET of the platform's path on the document's origin", () => {
    const origin =
      "https://0123456789abcdef0123456789abcdef0123456789abcdef0123.magnacartausercontent.com";
    expect(isStatusRequest(new Request(`${origin}${CONTAINER_STATUS_PATH}`))).toBe(true);
    expect(isStatusRequest(new Request(`${origin}/browser/dist/cool.html`))).toBe(false);
    expect(CONTAINER_STATUS_PATH.startsWith("/magna-carta/")).toBe(true);
  });

  it("answers the events as JSON, never cached", async () => {
    const events = [event("requested", 0), event("started", 0.3)];
    const response = statusResponse(events);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ events });
  });
});
