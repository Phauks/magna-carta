// @vitest-environment happy-dom
/*
 * What a call looks like: a tile with nobody's picture in it, and a control bar with nothing in it
 * that a call cannot do.
 *
 * Both are the same rule from two sides. A call is not a meeting with the cameras off — it is a room
 * whose people agreed to sound — so the surfaces do not render a dark video element, and they do not
 * render a camera control that would be refused if it were pressed.
 *
 * WHAT A CALL DOES STILL DO IS BE HEARD, and the element that carries the sound is not the tile's.
 * A browser pulls more voices than it draws tiles, and ranks the two differently on purpose, so
 * somebody answering a question from another page is heard while their tile is nowhere on screen.
 * Every voice is played once, in one place, which is what the last case here asserts: a room full
 * of faces and no sound is the obvious way to get this wrong, and so is a room that goes silent the
 * moment somebody turns a page.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import MeetingTile from "../src/lib/meetings/meeting-tile.svelte";
import MeetingAudio from "../src/lib/meetings/meeting-audio.svelte";
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
  it("draws the person rather than a dark rectangle, and carries no media of its own", () => {
    const rendered = drawTile({ name: "Rosalind Chase", medium: "audio" });

    expect(rendered.querySelector("video")).toBeNull();
    expect(rendered.textContent).toContain("RC");
    expect(rendered.textContent).toContain("Rosalind Chase");
    // Nothing is played here: the voices are played together, below.
    expect(rendered.querySelector("audio")).toBeNull();
  });

  it("keeps the picture in a meeting", () => {
    const rendered = drawTile({ name: "Rosalind Chase", medium: "video" });

    expect(rendered.querySelector("video")).not.toBeNull();
    expect(rendered.querySelector("audio")).toBeNull();
  });
});

describe("the sound of the room", () => {
  it("plays one element per voice, whether or not that person has a tile on this page", () => {
    const streams = new Map([
      ["attendance_2", new MediaStream()],
      ["attendance_40", new MediaStream()],
    ]);

    instance = mount(MeetingAudio, { target, props: { streams } });
    flushSync();

    // Two voices, two elements — and attendance_40 is on no page this browser is showing.
    expect(target.querySelectorAll("audio")).toHaveLength(2);
    for (const element of target.querySelectorAll("audio")) {
      expect(element.autoplay).toBe(true);
    }
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
    // Speaker view is a way of arranging pictures, and a call has none.
    expect(named.some((label) => label.includes("talking, large"))).toBe(false);
    expect(rendered.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe(
      "Call controls",
    );
  });

  it("holds all four in a meeting, and the way the room is arranged", () => {
    const rendered = drawControls({
      microphoneOn: true,
      cameraOn: true,
      sharing: false,
      medium: "video",
      canEnd: true,
      onEnd: () => Promise.resolve("committed"),
      onToggleSpeakerView: () => {},
      ...handlers,
    });

    const named = labels(rendered);
    expect(named).toContain("Turn your camera off");
    expect(named).toContain("Share your screen");
    expect(named).toContain("Show whoever is talking, large");
    expect(named).toContain("End Meeting");
  });

  it("says which way the room is arranged through the control's own state", () => {
    const rendered = drawControls({
      microphoneOn: true,
      cameraOn: true,
      sharing: false,
      speakerView: true,
      medium: "video",
      onToggleSpeakerView: () => {},
      ...handlers,
    });

    const toggle = [...rendered.querySelectorAll("button")].find(
      (control) => control.getAttribute("aria-label") === "Show everybody",
    );
    // The glyph is the same on both sides, so the pressed state is what a reader who cannot see the
    // fill is told.
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
  });
});
