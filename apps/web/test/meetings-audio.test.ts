// @vitest-environment happy-dom
/*
 * What a call looks like: a tile with nobody's picture in it, and a control bar with nothing in it
 * that a call cannot do.
 *
 * Both are the same rule from two sides. A call is not a meeting with the cameras off — it is a room
 * whose people agreed to sound — so the surfaces do not render a dark video element, and they do not
 * render a camera control that would be refused if it were pressed. What a call DOES still do is be
 * heard, which is why the tile keeps a media element even where it draws initials: a room full of
 * faces and no sound would be the obvious way to get this wrong.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MeetingTile from "../src/lib/meetings/meeting-tile.svelte";
import MeetingControls from "./meeting-controls-harness.svelte";
import { participantInitials } from "../src/lib/meetings/meeting-tiles.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

function drawTile(props: ComponentProps<typeof MeetingTile>): HTMLElement {
  instance = mount(MeetingTile, { target, props });
  flushSync();
  return target;
}

function drawControls(props: ComponentProps<typeof MeetingControls>): HTMLElement {
  instance = mount(MeetingControls, { target, props });
  flushSync();
  return target;
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
});

describe("the initials somebody is drawn as", () => {
  it("takes one letter per word, two at most, and copes with what a roster can hold", () => {
    expect(participantInitials("Rosalind Chase")).toBe("RC");
    expect(participantInitials("Rosalind")).toBe("R");
    expect(participantInitials("Rosalind du Chase Baxter")).toBe("RD");
    expect(participantInitials("")).toBe("");
  });
});

describe("a tile in a call", () => {
  it("draws the person rather than a dark rectangle, and still plays them", () => {
    const rendered = drawTile({ name: "Rosalind Chase", medium: "audio" });

    expect(rendered.querySelector("video")).toBeNull();
    expect(rendered.textContent).toContain("RC");
    expect(rendered.textContent).toContain("Rosalind Chase");
    // The element that carries the sound is there even though there is nothing to look at.
    expect(rendered.querySelector("audio")).not.toBeNull();
  });

  it("keeps the picture in a meeting", () => {
    const rendered = drawTile({ name: "Rosalind Chase", medium: "video" });

    expect(rendered.querySelector("video")).not.toBeNull();
    expect(rendered.querySelector("audio")).toBeNull();
  });
});

describe("the control bar in a call", () => {
  const handlers = {
    onToggleMicrophone: () => {},
    onToggleCamera: () => {},
    onToggleSharing: () => {},
    onLeave: () => {},
  };

  function labels(rendered: HTMLElement): string[] {
    return [...rendered.querySelectorAll("button")].map(
      (control) => control.getAttribute("aria-label") ?? control.textContent?.trim() ?? "",
    );
  }

  it("holds the microphone and the way out, and no control a call cannot honour", () => {
    const rendered = drawControls({
      microphoneOn: true,
      cameraOn: false,
      sharing: false,
      medium: "audio",
      canEnd: true,
      onEnd: () => Promise.resolve("committed"),
      ...handlers,
    });

    const named = labels(rendered);
    expect(named).toContain("Mute your microphone");
    expect(named.some((label) => label.includes("camera"))).toBe(false);
    expect(named.some((label) => label.includes("screen"))).toBe(false);
    // A call is ended as a call.
    expect(named).toContain("End Call");
    expect(rendered.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      "Call controls",
    );
  });

  it("holds all four in a meeting", () => {
    const rendered = drawControls({
      microphoneOn: true,
      cameraOn: true,
      sharing: false,
      medium: "video",
      canEnd: true,
      onEnd: () => Promise.resolve("committed"),
      ...handlers,
    });

    const named = labels(rendered);
    expect(named).toContain("Turn your camera off");
    expect(named).toContain("Share your screen");
    expect(named).toContain("End Meeting");
  });
});
