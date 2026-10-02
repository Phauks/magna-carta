// @vitest-environment happy-dom
/*
 * A raised hand and a thrown reaction: the two signals a meeting relays and never keeps.
 *
 * THE HALF THAT WOULD BE EXPENSIVE TO GET WRONG is the outgoing window. The room REFUSES a second
 * signal inside it rather than dropping one, precisely so that nothing an act says is ever lost —
 * and the browser's half of that bargain is to pace itself and, where it is refused anyway, to send
 * the SETTLED hand again once the window passes. A reaction is not re-sent: it was thrown at a
 * moment, and throwing it a second later is a different act nobody asked for. Both halves are
 * asserted below, because both fail silently in a real room: a hand that never reaches the host is
 * a member waiting to speak with nothing on anybody's screen saying so.
 *
 * THE OTHER HALF IS WHAT THE SCREEN OFFERS AND WITHHOLDS. Six items and no seventh, each carrying
 * its own WORD rather than the name of a picture; a queue ordered by when each hand went up and
 * never by roster order; and a member who is not running the meeting seeing neither the queue nor
 * any way to put somebody else's hand down — absent, not disabled, on this band's standing rule.
 *
 * WHAT IS NOT ASSERTED is anything about pixels. These render under happy-dom, so the questions are
 * what markup can answer: what is drawn, what it is called, and what pressing it does.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  handsInRaisedOrder,
  MAX_REACTIONS_ON_ONE_TILE,
  MeetingReactions,
  readReactionCounts,
  REACTION_DWELL_MILLISECONDS,
  REACTION_DWELL_STYLE,
  reactionWord,
  SIGNAL_INTERVAL_MILLISECONDS,
  type MeetingReactionSeams,
} from "$lib/meetings/client/reactions.svelte.ts";
import Menu from "../src/lib/meetings/screen/meeting-reactions.svelte";
import CountsStrip from "../src/lib/meetings/screen/meeting-reaction-counts.svelte";
import HandsPanel from "../src/lib/meetings/screen/meeting-hands-panel.svelte";
import Controls from "./meeting-controls-harness.svelte";

type ControlsProps = ComponentProps<typeof Controls>;

/**
 * The three edges the module reaches the world through, driven by hand.
 *
 * The clock moves only when a case moves it, which is the whole point: a window measured in real
 * seconds is a case that either waits a second or passes by luck.
 */
class Seams implements MeetingReactionSeams {
  readonly sent: Record<string, unknown>[] = [];
  /** Every wait in flight, in the order it was armed. */
  readonly waits: { milliseconds: number; run: () => void; cancelled: boolean }[] = [];
  milliseconds = 0;
  microphoneState = { speaking: false, muted: false };

  send(frame: Record<string, unknown>): void {
    this.sent.push(frame);
  }

  microphone(): { readonly speaking: boolean; readonly muted: boolean } {
    return this.microphoneState;
  }

  now(): number {
    return this.milliseconds;
  }

  after(milliseconds: number, run: () => void): () => void {
    const wait = { milliseconds, run, cancelled: false };
    this.waits.push(wait);
    return () => {
      wait.cancelled = true;
    };
  }

  /** Move the clock on, and run everything that was waiting for that long or less. */
  passes(milliseconds: number): void {
    this.milliseconds += milliseconds;
    // Read before anything runs: a wait that arms another one belongs to the NEXT pass, not this.
    const due = this.waits.filter((wait) => !wait.cancelled && wait.milliseconds <= milliseconds);
    for (const wait of due) {
      wait.cancelled = true;
      wait.run();
    }
  }

  framesOfType(type: string): Record<string, unknown>[] {
    return this.sent.filter((frame) => frame.type === type);
  }
}

describe("the window a browser paces itself against", () => {
  it("sends one signal per window and refuses to send the next itself", () => {
    const seams = new Seams();
    seams.milliseconds = SIGNAL_INTERVAL_MILLISECONDS;
    const reactions = new MeetingReactions(seams);

    expect(reactions.react("thumbs-up", "attendance_1")).toBe(true);
    // A second inside the window would be refused by the room, so the browser does not spend it.
    expect(reactions.react("heart", "attendance_1")).toBe(false);

    expect(seams.framesOfType("reaction")).toEqual([{ type: "reaction", name: "thumbs-up" }]);

    seams.passes(SIGNAL_INTERVAL_MILLISECONDS);
    expect(reactions.react("heart", "attendance_1")).toBe(true);
    expect(seams.framesOfType("reaction")).toHaveLength(2);
  });

  it("states the hand on the ordinary presence frame, whole", () => {
    const seams = new Seams();
    seams.milliseconds = SIGNAL_INTERVAL_MILLISECONDS;
    seams.microphoneState = { speaking: true, muted: false };
    const reactions = new MeetingReactions(seams);

    expect(reactions.raiseHand()).toBe(true);

    // A presence frame carries the whole of what it is about; a frame that stated the hand and
    // guessed at the other two would relay a speaking transition nobody measured.
    expect(seams.framesOfType("presence")).toEqual([
      { type: "presence", speaking: true, muted: false, hand: true },
    ]);
    expect(reactions.hand).toBe(true);
  });

  it("sends the SETTLED hand again after the room refuses one, and not the reaction", () => {
    const seams = new Seams();
    seams.milliseconds = SIGNAL_INTERVAL_MILLISECONDS;
    const reactions = new MeetingReactions(seams);

    reactions.raiseHand();
    // The room refused it anyway — a second tab, or a clock that disagrees with the room's.
    reactions.noteRateLimited();
    expect(seams.framesOfType("presence")).toHaveLength(1);

    seams.passes(SIGNAL_INTERVAL_MILLISECONDS);

    // A hand is a standing state the room is now wrong about, so it is stated again.
    expect(seams.framesOfType("presence")).toEqual([
      { type: "presence", speaking: false, muted: false, hand: true },
      { type: "presence", speaking: false, muted: false, hand: true },
    ]);
    // And a reaction refused is let go: it was thrown at a moment that has passed.
    expect(seams.framesOfType("reaction")).toEqual([]);
  });

  it("states the SETTLED hand rather than replaying the press that was refused", () => {
    const seams = new Seams();
    seams.milliseconds = SIGNAL_INTERVAL_MILLISECONDS;
    const reactions = new MeetingReactions(seams);

    reactions.raiseHand();
    reactions.noteRateLimited();
    // Raised and lowered inside one window. Replaying the raise would leave the room holding a
    // hand the member has already put down.
    reactions.lowerHand();
    seams.passes(SIGNAL_INTERVAL_MILLISECONDS);

    expect(seams.framesOfType("presence").at(-1)).toEqual({
      type: "presence",
      speaking: false,
      muted: false,
      hand: false,
    });
    expect(reactions.hand).toBe(false);
  });

  it("lands a press the browser paced out, once the window passes", () => {
    const seams = new Seams();
    seams.milliseconds = SIGNAL_INTERVAL_MILLISECONDS;
    const reactions = new MeetingReactions(seams);

    reactions.react("heart", "attendance_1");
    // Inside the window, so nothing leaves now — and the window is a second. A browser that simply
    // dropped it would leave this member's own tile saying one thing and the host's queue another.
    expect(reactions.raiseHand()).toBe(false);
    expect(seams.framesOfType("presence")).toEqual([]);
    expect(reactions.hand).toBe(true);

    seams.passes(SIGNAL_INTERVAL_MILLISECONDS);

    expect(seams.framesOfType("presence")).toEqual([
      { type: "presence", speaking: false, muted: false, hand: true },
    ]);
  });

  it("owes one re-statement however many times the hand moves inside the window", () => {
    const seams = new Seams();
    seams.milliseconds = SIGNAL_INTERVAL_MILLISECONDS;
    const reactions = new MeetingReactions(seams);

    reactions.react("heart", "attendance_1");
    reactions.raiseHand();
    reactions.lowerHand();
    reactions.raiseHand();
    seams.passes(SIGNAL_INTERVAL_MILLISECONDS);

    expect(seams.framesOfType("presence")).toHaveLength(1);
    expect(seams.framesOfType("presence")[0]).toMatchObject({ hand: true });
  });
});

describe("what is drawn on a tile, and for how long", () => {
  it("holds a reaction for the dwell and then stops drawing it at all", () => {
    const seams = new Seams();
    const reactions = new MeetingReactions(seams);

    reactions.noteReaction("attendance_2", "applause", "Rosalind Chase");
    expect(reactions.shown.get("attendance_2")?.map((one) => one.name)).toEqual(["applause"]);
    expect(reactions.announcement).toBe("Rosalind Chase reacted: Well said");

    seams.passes(REACTION_DWELL_MILLISECONDS);

    // There is no closed state and nothing to fade back to: the mark is drawn for its dwell and
    // then is not drawn, which is also why the tile is not permanently decorated.
    expect(reactions.shown.has("attendance_2")).toBe(false);
  });

  it("stacks several on one tile rather than replacing, bounded so a burst cannot cover a face", () => {
    const seams = new Seams();
    const reactions = new MeetingReactions(seams);

    for (const name of ["thumbs-up", "heart", "laugh", "applause", "celebrate"] as const) {
      reactions.noteReaction("attendance_2", name, "Rosalind Chase");
    }

    // Three people agreeing in the same second is three facts; a tile showing only the last of
    // them would say one person agreed.
    expect(reactions.shown.get("attendance_2")).toHaveLength(MAX_REACTIONS_ON_ONE_TILE);
  });

  it("says nothing about this member's own reaction, because they are looking at it", () => {
    const seams = new Seams();
    seams.milliseconds = SIGNAL_INTERVAL_MILLISECONDS;
    const reactions = new MeetingReactions(seams);

    reactions.react("heart", "attendance_1");

    expect(reactions.shown.get("attendance_1")?.map((one) => one.name)).toEqual(["heart"]);
    expect(reactions.announcement).toBe("");
  });

  it("replaces the counts strip whole rather than accumulating it", () => {
    const seams = new Seams();
    const reactions = new MeetingReactions(seams);

    reactions.noteCounts([{ name: "applause", count: 11 }]);
    reactions.noteCounts([{ name: "applause", count: 4 }]);

    // A frame carries the whole of the second it covers; a strip that added would be counting the
    // same applause twice a second.
    expect(reactions.counts).toEqual([{ name: "applause", count: 4 }]);

    seams.passes(REACTION_DWELL_MILLISECONDS);
    expect(reactions.counts).toEqual([]);
  });

  it("reads a counts frame in the vocabulary's own order, and never a zero", () => {
    expect(readReactionCounts({ celebrate: 2, "thumbs-up": 5, laugh: 0, shrug: 9 })).toEqual([
      { name: "thumbs-up", count: 5 },
      { name: "celebrate", count: 2 },
    ]);
    expect(readReactionCounts(null)).toEqual([]);
  });
});

describe("the order a host works the queue in", () => {
  it("is when each hand went up, and never the roster's own order", () => {
    const ordered = handsInRaisedOrder([
      { participantId: "attendance_2", handRaisedAt: "2026-09-20T15:05:00.000Z" },
      { participantId: "attendance_3", handRaisedAt: "2026-09-20T15:01:00.000Z" },
      { participantId: "attendance_4", handRaisedAt: "2026-09-20T15:03:00.000Z" },
    ]);

    expect(ordered.map((hand) => hand.participantId)).toEqual([
      "attendance_3",
      "attendance_4",
      "attendance_2",
    ]);
  });

  it("puts a hand the room said nothing about the time of LAST, not first", () => {
    const ordered = handsInRaisedOrder([
      { participantId: "attendance_2", handRaisedAt: null },
      { participantId: "attendance_3", handRaisedAt: "2026-09-20T15:01:00.000Z" },
    ]);

    // An unstamped hand is one this browser learned of without being told when; putting it at the
    // head would hand the floor to whoever the room said least about.
    expect(ordered.map((hand) => hand.participantId)).toEqual(["attendance_3", "attendance_2"]);
  });
});

describe("the reaction mark's motion", () => {
  it("hands the design system's recipe the dwell the client decided, and nothing else", () => {
    // The recipe animates over `--mc-reaction-dwell` and declares a token default; the ONE home for
    // the number is the client constant, so a stylesheet that wrote four seconds down would be a
    // second copy that drifts the first time either moves.
    expect(REACTION_DWELL_STYLE).toBe(
      `--mc-reaction-dwell: ${String(REACTION_DWELL_MILLISECONDS)}ms`,
    );
  });
});

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;
let thrown: string[] = [];
let asked: string[] = [];

/** Every control on the page, wherever it was rendered — a menu and a panel are portalled. */
function controls(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

function named(name: string): HTMLButtonElement | undefined {
  return controls().find((control) => control.getAttribute("aria-label") === name);
}

function labelled(words: string): HTMLButtonElement | undefined {
  return controls().find((control) => control.textContent?.trim() === words);
}

/**
 * Open a menu the way a keyboard does.
 *
 * A press is a pointer sequence the menu reads off `pointerdown`, and happy-dom's synthetic click
 * carries no pointer at all — so the keyboard path is both the one that works here and the one
 * worth asserting: a menu a keyboard cannot open is a menu half the readers of this product cannot
 * use.
 */
function openMenu(trigger: HTMLElement | undefined): void {
  trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  flushSync();
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  thrown = [];
  asked = [];
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  for (const floating of document.body.querySelectorAll("[data-bits-floating-content-wrapper]")) {
    floating.remove();
  }
});

describe("the reactions control", () => {
  it("offers exactly six, each named by what it MEANS rather than by its picture", () => {
    instance = mount(Menu, {
      target,
      props: { onReact: (name: string) => thrown.push(name) },
    });
    flushSync();

    openMenu(named("React"));

    const items = [...document.body.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.getAttribute("aria-label") ?? "",
    );
    // Six, and closed to growth without a decision: a seventh is a protocol change.
    expect(items).toEqual([
      reactionWord("thumbs-up"),
      reactionWord("thumbs-down"),
      reactionWord("heart"),
      reactionWord("laugh"),
      reactionWord("applause"),
      reactionWord("celebrate"),
    ]);
    expect(items).toEqual([
      "Agree",
      "Disagree",
      "Thank you",
      "That is funny",
      "Well said",
      "Congratulations",
    ]);
  });

  it("throws one and closes, because a reaction is not a mode you enter", () => {
    instance = mount(Menu, {
      target,
      props: { onReact: (name: string) => thrown.push(name) },
    });
    flushSync();

    openMenu(named("React"));
    const agree = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.getAttribute("aria-label") === "Agree",
    );
    (agree as HTMLElement | undefined)?.click();
    flushSync();

    expect(thrown).toEqual(["thumbs-up"]);
  });
});

describe("the counts strip", () => {
  it("draws nothing at all when nothing has arrived", () => {
    instance = mount(CountsStrip, { target, props: { counts: [] } });
    flushSync();

    expect(target.textContent?.trim()).toBe("");
  });

  it("states the number, which is what is true at a size nobody can attribute", () => {
    instance = mount(CountsStrip, {
      target,
      props: { counts: [{ name: "applause" as const, count: 11 }] },
    });
    flushSync();

    expect(target.textContent).toContain("11");
    // And it is not announced: a stream of changing counts read out once a second is noise.
    expect(target.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe("the host's queue", () => {
  function handsProps(
    hands: readonly { participantId: string; name: string; muted: boolean }[],
  ): ComponentProps<typeof HandsPanel> {
    return {
      open: true,
      subject: { facts: ["Hearing preparation"] },
      hands,
      onAskToUnmute: (participantId: string) => asked.push(`unmute:${participantId}`),
      onLowerHand: (participantId: string) => asked.push(`lower:${participantId}`),
      onLowerAll: () => asked.push("lower-all"),
    };
  }

  it("draws the rows in the order it was handed, which is the order the hands went up", () => {
    instance = mount(HandsPanel, {
      target,
      props: handsProps([
        { participantId: "attendance_3", name: "Theodore Vance", muted: true },
        { participantId: "attendance_2", name: "Rosalind Chase", muted: false },
      ]),
    });
    flushSync();

    const rows = [...document.body.querySelectorAll("li")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("Theodore Vance");
    expect(rows[1]).toContain("Rosalind Chase");
  });

  it("names the person each control is about, and offers Ask to Unmute only where it means anything", () => {
    instance = mount(HandsPanel, {
      target,
      props: handsProps([
        { participantId: "attendance_3", name: "Theodore Vance", muted: true },
        { participantId: "attendance_2", name: "Rosalind Chase", muted: false },
      ]),
    });
    flushSync();

    expect(named("Ask Theodore Vance to unmute")).toBeDefined();
    // Asking somebody who is already unmuted to unmute is a tap on the shoulder about nothing.
    expect(named("Ask Rosalind Chase to unmute")).toBeUndefined();

    named("Lower Rosalind Chase's hand")?.click();
    flushSync();
    expect(asked).toEqual(["lower:attendance_2"]);
  });

  it("offers Lower All only past one hand, and states an empty queue inside the list", () => {
    instance = mount(HandsPanel, {
      target,
      props: handsProps([{ participantId: "attendance_2", name: "Rosalind Chase", muted: false }]),
    });
    flushSync();
    expect(labelled("Lower All Hands")).toBeUndefined();

    void unmount(instance);
    instance = mount(HandsPanel, { target, props: handsProps([]) });
    flushSync();

    expect(document.body.textContent).toContain("Nobody has their hand up.");
  });
});

describe("the band's own hand controls", () => {
  function bar(over: Partial<ControlsProps> = {}): ControlsProps {
    return {
      microphoneOn: true,
      cameraOn: true,
      sharing: false,
      hosting: true,
      handRaised: false,
      raisedHandCount: 0,
      onToggleMicrophone: () => {},
      onToggleCamera: () => {},
      onToggleSharing: () => {},
      onToggleHand: () => asked.push("toggle-hand"),
      onOpenHands: () => asked.push("open-hands"),
      onLowerAllHands: () => asked.push("lower-all"),
      onLeave: () => {},
      ...over,
    };
  }

  it("is one control that says which way the press goes", () => {
    instance = mount(Controls, { target, props: bar() });
    flushSync();
    expect(named("Raise your hand")).toBeDefined();

    void unmount(instance);
    instance = mount(Controls, { target, props: bar({ handRaised: true }) });
    flushSync();

    // Raising and lowering are the same act read from either side, so the control holds its place.
    expect(named("Lower your hand")).toBeDefined();
    expect(named("Raise your hand")).toBeUndefined();
    named("Lower your hand")?.click();
    flushSync();
    expect(asked).toEqual(["toggle-hand"]);
  });

  it("carries the count, so a host learns somebody wants the floor without opening anything", () => {
    instance = mount(Controls, { target, props: bar({ raisedHandCount: 3 }) });
    flushSync();

    const control = controls().find((one) => one.textContent?.includes("Hands"));
    expect(control?.textContent?.replace(/\s+/gu, " ").trim()).toBe("Hands 3");
  });

  it("wears no count when nobody has their hand up, rather than a zero", () => {
    instance = mount(Controls, { target, props: bar() });
    flushSync();

    const control = controls().find((one) => one.textContent?.includes("Hands"));
    expect(control?.textContent?.replace(/\s+/gu, " ").trim()).toBe("Hands");
  });

  it("gives a member who is not running the meeting the toggle and nothing else", () => {
    instance = mount(Controls, { target, props: bar({ hosting: false, raisedHandCount: 2 }) });
    flushSync();

    // Absent, not disabled, on this band's own standing rule: a disabled control would say "this
    // could happen here" about an act that could not.
    expect(named("Raise your hand")).toBeDefined();
    expect(controls().some((one) => one.textContent?.includes("Hands"))).toBe(false);
    expect(controls().some((one) => one.textContent?.includes("Host Controls"))).toBe(false);
  });

  it("offers Lower All Hands in the host menu only while there is a floor to clear", () => {
    instance = mount(Controls, { target, props: bar({ raisedHandCount: 0 }) });
    flushSync();
    openMenu(named("Host controls"));
    expect(
      [...document.body.querySelectorAll('[role="menuitem"]')].some((item) =>
        item.textContent?.includes("Lower All Hands"),
      ),
    ).toBe(false);

    void unmount(instance);
    instance = mount(Controls, { target, props: bar({ raisedHandCount: 2 }) });
    flushSync();
    openMenu(named("Host controls"));

    const item = [...document.body.querySelectorAll('[role="menuitem"]')].find((one) =>
      one.textContent?.includes("Lower All Hands"),
    );
    expect(item).toBeDefined();
    (item as HTMLElement | undefined)?.click();
    flushSync();
    expect(asked).toEqual(["lower-all"]);
  });
});
