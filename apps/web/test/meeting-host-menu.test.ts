// @vitest-environment happy-dom
/*
 * What a host may do about somebody, and what everybody else is offered instead — which is nothing.
 *
 * THE ABSENCES ARE THE POINT OF THIS FILE. A member who is not running the meeting has no menu on
 * anybody's tile and no Host Controls in the band; a co-host has the menu but not the two items only
 * the host may press; and a co-host looking at the host has no menu at all, because every act it
 * would offer is one the route has already decided to refuse. Each of those is a rendering decision
 * that no type can hold and that fails silently the other way — as a member pressing an item and
 * being told no, over and over, by a room that was never going to let them.
 *
 * WHAT IS NOT ASSERTED HERE is anything about pixels. These render under happy-dom, so the questions
 * are what markup can answer: what is drawn, what it is called, and what pressing it does.
 */
import { flushSync, mount, unmount, type ComponentProps } from "svelte";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Harness from "./meeting-host-menu-harness.svelte";
import Controls from "./meeting-controls-harness.svelte";
import type { ActionOutcome } from "@magna-carta/design-system/action-dialog";

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

/** Nothing pressed here reaches a server: each is a note that the act was asked for. */
let asked: string[] = [];

type MenuProps = ComponentProps<typeof Harness>;
type ControlsProps = ComponentProps<typeof Controls>;

function menuProps(over: Partial<MenuProps> = {}): MenuProps {
  return {
    name: "Rosalind Chase",
    viewerRole: "host",
    targetRole: null,
    spotlighted: false,
    onMute: () => asked.push("mute"),
    onAskToUnmute: () => asked.push("ask-to-unmute"),
    onSpotlight: (wanted: boolean) => asked.push(wanted ? "spotlight" : "clear-spotlight"),
    onMakeCoHost: () => asked.push("make-co-host"),
    onWithdrawCoHost: () => asked.push("withdraw-co-host"),
    onHandHosting: (): Promise<ActionOutcome> => {
      asked.push("hand-hosting");
      return Promise.resolve("committed");
    },
    onRemove: (): Promise<ActionOutcome> => {
      asked.push("remove");
      return Promise.resolve("committed");
    },
    ...over,
  };
}

/** Every control on the page, wherever it was rendered — a menu is portalled to the document. */
function controls(): HTMLButtonElement[] {
  return [...document.body.querySelectorAll("button")];
}

function named(name: string): HTMLButtonElement | undefined {
  return controls().find((control) => control.getAttribute("aria-label") === name);
}

/** The words on every menu item the document is showing. */
function menuItems(): string[] {
  return [...document.body.querySelectorAll('[role="menuitem"]')].map(
    (item) => item.textContent?.trim() ?? "",
  );
}

/**
 * Open a menu the way a keyboard does.
 *
 * A press is a pointer sequence the menu reads off `pointerdown`, and happy-dom's synthetic click
 * carries no pointer at all — so the keyboard path is both the one that works here and the one worth
 * asserting: a menu a keyboard cannot open is a menu half the readers of this product cannot use.
 */
function openMenu(trigger: HTMLElement | undefined): void {
  trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  flushSync();
}

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  asked = [];
});

afterEach(() => {
  if (instance !== undefined) void unmount(instance);
  instance = undefined;
  target.remove();
  // A menu portals its content to the document, so what one case opened would otherwise be read by
  // the next one as something this render drew.
  for (const menu of document.body.querySelectorAll('[role="menu"]')) menu.remove();
});

describe("a member who is not running the meeting", () => {
  it("is offered nothing on anybody's tile — absent, not disabled", () => {
    instance = mount(Harness, { target, props: menuProps({ viewerRole: null }) });
    flushSync();

    expect(named("Host controls for Rosalind Chase")).toBeUndefined();
    expect(target.textContent?.trim()).toBe("");
  });
});

describe("a host", () => {
  it("is offered every act, the two that cannot be walked back behind a panel", () => {
    instance = mount(Harness, { target, props: menuProps() });
    flushSync();

    openMenu(named("Host controls for Rosalind Chase"));

    expect(menuItems()).toEqual([
      "Mute",
      "Ask to Unmute",
      "Spotlight for Everyone",
      "Make Co-host",
      "Hand Hosting Over",
      "Remove from the Meeting",
    ]);
  });

  it("names the act that would come next, not the state that is", () => {
    instance = mount(Harness, {
      target,
      props: menuProps({ spotlighted: true, targetRole: "co-host" }),
    });
    flushSync();

    openMenu(named("Host controls for Rosalind Chase"));

    expect(menuItems()).toContain("Stop Spotlighting");
    expect(menuItems()).toContain("Withdraw Co-host");
    expect(menuItems()).not.toContain("Make Co-host");
  });
});

describe("a co-host", () => {
  it("runs the meeting WITH the host and not over them", () => {
    instance = mount(Harness, { target, props: menuProps({ viewerRole: "co-host" }) });
    flushSync();

    openMenu(named("Host controls for Rosalind Chase"));

    // Muting, asking and spotlighting are theirs; naming who runs the room is not.
    expect(menuItems()).toEqual([
      "Mute",
      "Ask to Unmute",
      "Spotlight for Everyone",
      "Remove from the Meeting",
    ]);
  });

  it("has no menu at all on the host, because every item would be refused", () => {
    instance = mount(Harness, {
      target,
      props: menuProps({ viewerRole: "co-host", targetRole: "host" }),
    });
    flushSync();

    expect(named("Host controls for Rosalind Chase")).toBeUndefined();
  });
});

describe("putting somebody out of the room", () => {
  it("asks first, in the panel the product asks destructive acts in", async () => {
    instance = mount(Harness, { target, props: menuProps() });
    flushSync();

    openMenu(named("Host controls for Rosalind Chase"));
    const remove = [...document.body.querySelectorAll('[role="menuitem"]')].find(
      (item) => item.textContent?.trim() === "Remove from the Meeting",
    );
    expect(remove).toBeDefined();
    remove?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    flushSync();
    await Promise.resolve();
    flushSync();

    // Opening the menu item performs nothing: a removal is a fact about what happened to a member
    // in a meeting on a matter's record, and it is asked for rather than pressed past.
    expect(asked).toEqual([]);
    const panel = document.body.querySelector('[role="alertdialog"]');
    expect(panel).not.toBeNull();
    expect(panel?.textContent).toContain("cannot come back into this meeting");

    const commit = [...document.body.querySelectorAll("button")].find(
      (control) => control.textContent?.trim() === "Remove",
    );
    commit?.click();
    await Promise.resolve();
    flushSync();

    expect(asked).toEqual(["remove"]);
  });
});

describe("the control bar's own menu", () => {
  function bar(over: Partial<ControlsProps> = {}): ControlsProps {
    return {
      microphoneOn: true,
      cameraOn: true,
      sharing: false,
      hosting: true,
      locked: false,
      spotlighted: false,
      onToggleMicrophone: () => {},
      onToggleCamera: () => {},
      onToggleSharing: () => {},
      onMuteAll: () => asked.push("mute-all"),
      onSetLocked: (wanted: boolean) => asked.push(wanted ? "lock" : "unlock"),
      onClearSpotlight: () => asked.push("clear-spotlight"),
      onOpenHosts: () => asked.push("hosts"),
      onLeave: () => {},
      ...over,
    };
  }

  it("is absent for a member who is not hosting, rather than five controls they cannot use", () => {
    instance = mount(Controls, { target, props: bar({ hosting: false }) });
    flushSync();

    expect(named("Host controls")).toBeUndefined();
  });

  it("carries the acts over the whole room, each naming what it would do next", () => {
    instance = mount(Controls, { target, props: bar({ locked: true, spotlighted: true }) });
    flushSync();

    openMenu(named("Host controls"));

    expect(menuItems()).toEqual(["Mute Everyone", "Unlock the Room", "Stop Spotlighting", "Hosts"]);
  });

  it("offers no way to clear a spotlight nobody is in", () => {
    instance = mount(Controls, { target, props: bar() });
    flushSync();

    openMenu(named("Host controls"));

    expect(menuItems()).toEqual(["Mute Everyone", "Lock the Room", "Hosts"]);
  });
});
