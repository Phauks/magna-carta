// @vitest-environment happy-dom
/*
 * What a room of three hundred looks like: a page of tiles with a way to the next one, a name where
 * there is no picture, a mark on whoever is talking, and a rail that can be searched.
 *
 * EVERY CASE HERE IS A SENTENCE THE SCREEN SAYS TO SOMEBODY. "Page 2 of 19" is how a member knows
 * there are more people than the sixteen in front of them; "Not shown" is how they know a colleague
 * is in the room and simply not on this page, which is the ordinary state of most of a large
 * meeting and must never read as a picture that failed to load; the mark on a speaking tile is what
 * makes a page of sixteen faces answer "who said that".
 *
 * WHAT IS NOT ASSERTED HERE is anything about pixels. These are rendered under happy-dom, so the
 * questions are the ones markup can answer — what is drawn, what it is called, and what pressing it
 * does. Whether it LOOKS right is the browser's answer to give.
 */
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Gallery from "./meeting-gallery-harness.svelte";
import MeetingRoster from "../src/lib/meetings/screen/meeting-roster.svelte";
import type { MeetingTileModel } from "../src/lib/meetings/screen/meeting-tiles.ts";
import type { MeetingParticipant } from "../src/lib/meetings/client/meeting-client.svelte.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

function tile(ordinal: number, over: Partial<MeetingTileModel> = {}): MeetingTileModel {
  const participantId = `attendance_${ordinal}`;
  return {
    key: participantId,
    participantId,
    name: `Member ${ordinal}`,
    stream: null,
    local: false,
    microphoneOff: false,
    speaking: false,
    pinned: false,
    videoPulled: true,
    quality: "unknown",
    ...over,
  };
}

function participant(ordinal: number, over: Partial<MeetingParticipant> = {}): MeetingParticipant {
  const participantId = `attendance_${ordinal}`;
  return {
    participantId,
    userId: `user_${ordinal}`,
    displayName: `Member ${ordinal}`,
    sfuSessionId: `session_${ordinal}`,
    tracks: [{ trackName: `${participantId}:audio`, kind: "audio" }],
    speaking: false,
    muted: false,
    ...over,
  };
}

function controlNamed(name: string): HTMLButtonElement | undefined {
  return [...target.querySelectorAll("button")].find(
    (control) => control.getAttribute("aria-label") === name,
  );
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

describe("a gallery bigger than one page", () => {
  it("says which page this is, how many are shown, and offers the way on", () => {
    const turned: number[] = [];
    instance = mount(Gallery, {
      target,
      props: {
        tiles: Array.from({ length: 16 }, (_unused, index) => tile(index + 2)),
        page: 1,
        pages: 19,
        roomSize: 300,
        onPage: (wanted: number) => turned.push(wanted),
      },
    });
    flushSync();

    expect(target.textContent).toContain("Page 2 of 19");
    expect(target.textContent).toContain("Showing 16 of 300");

    controlNamed("Next page")?.click();
    controlNamed("Previous page")?.click();
    expect(turned).toEqual([2, 0]);
  });

  it("carries no paging chrome at all where the room fits on one page", () => {
    instance = mount(Gallery, {
      target,
      props: { tiles: [tile(2), tile(3)], page: 0, pages: 1, roomSize: 3 },
    });
    flushSync();

    expect(target.textContent).not.toContain("Page 1 of 1");
    expect(controlNamed("Next page")).toBeUndefined();
  });

  it("stops at both ends rather than offering a page that is not there", () => {
    instance = mount(Gallery, {
      target,
      props: { tiles: [tile(2)], page: 0, pages: 2, roomSize: 17 },
    });
    flushSync();

    expect(controlNamed("Previous page")?.disabled).toBe(true);
    expect(controlNamed("Next page")?.disabled).toBe(false);
  });
});

describe("a tile with no picture coming in", () => {
  it("is a name and initials saying it is not shown, never a wait", () => {
    instance = mount(Gallery, {
      target,
      props: {
        tiles: [tile(2, { name: "Rosalind Chase", videoPulled: false })],
      },
    });
    flushSync();

    expect(target.querySelector("video")).toBeNull();
    expect(target.textContent).toContain("RC");
    expect(target.textContent).toContain("Not shown");
    expect(target.textContent).toContain("Rosalind Chase");
  });

  it("keeps the picture's shape where the camera WAS asked for and has not arrived", () => {
    instance = mount(Gallery, {
      target,
      props: { tiles: [tile(2, { videoPulled: true })] },
    });
    flushSync();

    // A camera that was asked for is a tile that will fill; "Not shown" would be a lie about it.
    expect(target.querySelector("video")).not.toBeNull();
    expect(target.textContent).not.toContain("Not shown");
  });
});

describe("the marks a tile carries", () => {
  it("marks whoever is speaking, so a page of sixteen faces answers who said that", () => {
    instance = mount(Gallery, {
      target,
      props: { tiles: [tile(2), tile(3, { speaking: true })] },
    });
    flushSync();

    const speaking = [...target.querySelectorAll("figure")].filter(
      (one) => one.dataset.speaking === "true",
    );
    expect(speaking).toHaveLength(1);
    expect(speaking[0]?.textContent).toContain("Member 3");
  });

  it("marks muted from the roster, never from a voice this browser has not pulled", () => {
    // A browser pulls twenty-four microphones and draws sixteen tiles, ranked differently on
    // purpose — so a colleague whose camera is on this page while their voice is not among the ones
    // being pulled has a stream carrying a picture and no audio track at all. Reading that absence
    // as "Muted" tells the room somebody is silent who is talking.
    const camera = new MediaStream([{ kind: "video" } as unknown as MediaStreamTrack]);
    instance = mount(Gallery, {
      target,
      props: {
        tiles: [
          tile(2, {
            name: "Rosalind Chase",
            stream: camera,
            microphoneOff: false,
          }),
          tile(3, { name: "Marcus Webb", stream: camera, microphoneOff: true }),
        ],
      },
    });
    flushSync();

    const figures = [...target.querySelectorAll("figure")];
    const unmuted = figures.find((one) => one.textContent?.includes("Rosalind Chase"));
    const muted = figures.find((one) => one.textContent?.includes("Marcus Webb"));
    expect(unmuted?.textContent).not.toContain("Muted");
    // The roster saying so is what draws it, and it still does.
    expect(muted?.textContent).toContain("Muted");
  });

  it("offers a pin on a person's tile, and says which way it goes", () => {
    const pinned: string[] = [];
    instance = mount(Gallery, {
      target,
      props: {
        tiles: [
          tile(2, { name: "Rosalind Chase" }),
          tile(3, { name: "Marcus Webb", pinned: true }),
        ],
        onPin: (participantId: string) => pinned.push(participantId),
      },
    });
    flushSync();

    controlNamed("Pin Rosalind Chase")?.click();
    expect(pinned).toEqual(["attendance_2"]);
    // The glyph carries the state, so the control names the act it would do next.
    expect(controlNamed("Unpin Marcus Webb")).toBeDefined();
  });

  it("offers no pin on this browser's own preview, which is already where it belongs", () => {
    instance = mount(Gallery, {
      target,
      props: {
        tiles: [tile(1, { name: "You", local: true })],
        onPin: () => {},
      },
    });
    flushSync();

    expect(controlNamed("Pin You")).toBeUndefined();
  });
});

describe("the roster rail", () => {
  it("counts the room, and marks who is speaking and who is muted", () => {
    instance = mount(MeetingRoster, {
      target,
      props: {
        participants: [
          participant(1),
          participant(2, { speaking: true }),
          participant(3, { muted: true }),
        ],
        ownParticipantId: "attendance_1",
      },
    });
    flushSync();

    expect(target.textContent).toContain("In the Room (3)");
    expect(target.querySelector('[aria-label="Speaking"]')).not.toBeNull();
    expect(target.querySelector('[aria-label="Microphone off"]')).not.toBeNull();
    expect(target.textContent).toContain("(you)");
  });

  it("offers no search where a member can find a name by reading", () => {
    instance = mount(MeetingRoster, {
      target,
      props: { participants: [participant(1), participant(2)] },
    });
    flushSync();

    expect(controlNamed("Search the room")).toBeUndefined();
  });

  it("searches once the list has outgrown the eye, and says when nothing matches", () => {
    instance = mount(MeetingRoster, {
      target,
      props: {
        participants: Array.from({ length: 30 }, (_unused, index) =>
          participant(index + 1, {
            displayName: index === 7 ? "Rosalind Chase" : `Member ${index}`,
          }),
        ),
      },
    });
    flushSync();

    const control = controlNamed("Search the room");
    expect(control).toBeDefined();
    control?.click();
    flushSync();

    const field = target.querySelector("input");
    expect(field).not.toBeNull();
    if (field === null) return;

    field.value = "rosalind";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(target.querySelectorAll("li")).toHaveLength(1);
    expect(target.textContent).toContain("Rosalind Chase");

    field.value = "nobody at all";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(target.textContent).toContain("No Results");
  });
});
