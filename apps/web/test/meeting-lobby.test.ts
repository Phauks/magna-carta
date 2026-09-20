// @vitest-environment happy-dom
/*
 * The door, as the two people on either side of it see it.
 *
 * WHAT IS ASSERTED HERE IS WHAT NO TYPE CAN HOLD. Admit all sends the identifiers the panel was
 * SHOWING, which is the whole reason there is no server-side "everybody" — a list built anywhere
 * else would include whoever arrived in the millisecond after the host looked at it, who is
 * precisely the person the host did not decide about. Each row's controls name the person they are
 * about, because a panel of five rows otherwise offers a reader five controls called Admit. And the
 * waiting screen carries no media control at all, because there is no media: a browser that lit the
 * camera indicator for somebody standing outside would be taking a picture nobody asked for.
 *
 * WHAT IS NOT ASSERTED is anything about pixels. These render under happy-dom, so the questions are
 * what markup can answer: what is drawn, what it is called, and what pressing it does.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Panel from "./meeting-lobby-panel-harness.svelte";
import Wait from "../src/lib/meetings/meeting-lobby-wait.svelte";
import Controls from "./meeting-controls-harness.svelte";
import { doorDecisionStatement } from "$lib/meetings/meetings-api.ts";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/** Every stay a control here was pressed about, in the order it was pressed. */
let admitted: string[][] = [];
let denied: string[][] = [];
let left = 0;

type PanelProps = ComponentProps<typeof Panel>;
type ControlsProps = ComponentProps<typeof Controls>;

/** Somebody at the door, as the room's own `waiting` frame carries them. */
function waiter(ordinal: number, displayName: string) {
  return {
    participantId: `attendance_${ordinal}`,
    userId: `usr_${ordinal}`,
    displayName,
    waitingFrom: `2026-09-20T15:0${ordinal}:00.000Z`,
  };
}

function panelProps(over: Partial<PanelProps> = {}): PanelProps {
  return {
    open: true,
    subject: { facts: ["Hearing preparation"] },
    waiting: [waiter(2, "Rosalind Chase"), waiter(3, "Theodore Vance")],
    onAdmit: (participantIds: readonly string[]) => admitted.push([...participantIds]),
    onDeny: (participantIds: readonly string[]) => denied.push([...participantIds]),
    ...over,
  };
}

/** Every control on the page, wherever it was rendered — a panel is portalled to the document. */
function controls(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

function named(name: string): HTMLButtonElement | undefined {
  return controls().find((control) => control.getAttribute("aria-label") === name);
}

function labelled(words: string): HTMLButtonElement | undefined {
  return controls().find((control) => control.textContent?.trim() === words);
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  admitted = [];
  denied = [];
  left = 0;
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  // A panel portals its content to the document, so what one case opened would otherwise be read by
  // the next one as something this render drew.
  for (const panel of document.body.querySelectorAll('[role="dialog"]')) panel.remove();
});

describe("the host's lobby panel", () => {
  it("draws a row per person, with controls that name who they are about", () => {
    instance = mount(Panel, { target, props: panelProps() });
    flushSync();

    const shown = document.body.textContent ?? "";
    expect(shown).toContain("Rosalind Chase");
    expect(shown).toContain("Theodore Vance");
    expect(named("Admit Rosalind Chase")).toBeDefined();
    expect(named("Deny Rosalind Chase")).toBeDefined();
    expect(named("Admit Theodore Vance")).toBeDefined();
  });

  it("admits one person by their STAY, which is what every frame in this room is addressed by", () => {
    instance = mount(Panel, { target, props: panelProps() });
    flushSync();

    named("Admit Rosalind Chase")?.click();
    flushSync();

    expect(admitted).toEqual([["attendance_2"]]);
    expect(denied).toEqual([]);
  });

  it("sends exactly the identifiers it was SHOWING when Admit all is pressed", () => {
    instance = mount(Panel, { target, props: panelProps() });
    flushSync();

    labelled("Admit All")?.click();
    flushSync();

    // Never a server-side "everybody": that would admit whoever arrived in the millisecond after
    // the host looked at the list, which is the one person a lobby exists to let them decide about.
    expect(admitted).toEqual([["attendance_2", "attendance_3"]]);
  });

  it("offers no Admit all for a single row, which the row already does", () => {
    instance = mount(Panel, {
      target,
      props: panelProps({ waiting: [waiter(2, "Rosalind Chase")] }),
    });
    flushSync();

    expect(labelled("Admit All")).toBeUndefined();
    expect(named("Admit Rosalind Chase")).toBeDefined();
  });

  it("states an empty door inside the list rather than beside it", () => {
    instance = mount(Panel, { target, props: panelProps({ waiting: [] }) });
    flushSync();

    expect(document.body.textContent).toContain("Nobody is waiting");
    expect(labelled("Admit All")).toBeUndefined();
  });

  it("turns somebody away by their stay, and only that one", () => {
    instance = mount(Panel, { target, props: panelProps() });
    flushSync();

    named("Deny Theodore Vance")?.click();
    flushSync();

    expect(denied).toEqual([["attendance_3"]]);
    expect(admitted).toEqual([]);
  });
});

describe("what a batch at the door came to", () => {
  it("says nothing when it did all of it", () => {
    expect(
      doorDecisionStatement(
        { data: [{ participantId: "attendance_2", outcome: "admitted" }] },
        "admitted",
      ),
    ).toBeNull();
  });

  it("names the room filling, because that is the one reason worth waiting on", () => {
    // A host admitting three people into one free seat learns which two did not get in, rather than
    // watching two rows stay where they were and reading that as a control that did nothing.
    expect(
      doorDecisionStatement(
        {
          data: [
            { participantId: "attendance_2", outcome: "admitted" },
            { participantId: "attendance_3", outcome: "room-full" },
            { participantId: "attendance_4", outcome: "room-full" },
          ],
        },
        "admitted",
      ),
    ).toBe("2 people did not get in: the room is full.");
  });

  it("tells a stay that closed under the host apart from a room that filled", () => {
    expect(
      doorDecisionStatement(
        { data: [{ participantId: "attendance_2", outcome: "not-waiting" }] },
        "admitted",
      ),
    ).toBe("1 person was no longer waiting, so nothing changed for them.");
  });
});

describe("the waiting screen", () => {
  function waitProps(over: Record<string, unknown> = {}) {
    return {
      title: "Hearing preparation",
      when: "18 September 2026 at 9:00 AM MDT",
      place: { position: 1, waiting: 1, at: "2026-09-20T15:00:00.000Z" },
      leaving: false,
      onLeave: () => {
        left += 1;
      },
      ...over,
    } as ComponentProps<typeof Wait>;
  }

  it("names the meeting and offers exactly one act", () => {
    instance = mount(Wait, { target, props: waitProps() });
    flushSync();

    expect(target.textContent).toContain("Waiting to Be Let In");
    expect(target.textContent).toContain("Hearing preparation");
    // No microphone, no camera, no screen share, no roster: there is nothing to control, because
    // nothing is being captured or received.
    const offered = [...target.querySelectorAll("button")].map((one) => one.textContent?.trim());
    expect(offered).toEqual(["Leave"]);
  });

  it("closes this stay when the waiter gives up", () => {
    instance = mount(Wait, { target, props: waitProps() });
    flushSync();

    labelled("Leave")?.click();
    flushSync();

    expect(left).toBe(1);
  });

  it("says who is ahead only where somebody is", () => {
    instance = mount(Wait, { target, props: waitProps() });
    flushSync();
    expect(target.textContent).not.toContain("ahead of you");

    void unmount(instance);
    instance = mount(Wait, {
      target,
      props: waitProps({ place: { position: 3, waiting: 4, at: "2026-09-20T15:00:00.000Z" } }),
    });
    flushSync();

    expect(target.textContent).toContain("2 people are ahead of you.");
  });
});

describe("the control bar's lobby control", () => {
  function bar(over: Partial<ControlsProps> = {}): ControlsProps {
    return {
      microphoneOn: true,
      cameraOn: true,
      sharing: false,
      hosting: true,
      locked: false,
      lobby: "on",
      waitingCount: 0,
      spotlighted: false,
      onToggleMicrophone: () => {},
      onToggleCamera: () => {},
      onToggleSharing: () => {},
      onOpenLobby: () => admitted.push(["opened"]),
      onLeave: () => {},
      ...over,
    };
  }

  it("is absent for a member who is not running the meeting", () => {
    instance = mount(Controls, { target, props: bar({ hosting: false }) });
    flushSync();

    expect(labelled("Lobby")).toBeUndefined();
  });

  it("carries the count, so a host learns somebody arrived without opening anything", () => {
    instance = mount(Controls, { target, props: bar({ waitingCount: 3 }) });
    flushSync();

    const control = controls().find((one) => one.textContent?.includes("Lobby"));
    expect(control?.textContent?.replace(/\s+/gu, " ").trim()).toBe("Lobby 3");
  });

  it("wears no count when nobody is outside, rather than a zero", () => {
    instance = mount(Controls, { target, props: bar() });
    flushSync();

    const control = controls().find((one) => one.textContent?.includes("Lobby"));
    expect(control?.textContent?.replace(/\s+/gu, " ").trim()).toBe("Lobby");

    control?.click();
    flushSync();
    expect(admitted).toEqual([["opened"]]);
  });
});
