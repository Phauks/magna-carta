// @vitest-environment happy-dom
/*
 * The Beta Access page, as the owner walked it: on the released build, press the switch to join,
 * cancel the consent. The switch has to be off afterwards, because the firm is still on the
 * released build and the switch shows the firm, never the press.
 *
 * The defect this exists to end was a binding. The page drove the switch one-way
 * (`checked={onBeta}`), so the design system's Switch kept its own copy of `checked`, flipped it
 * on the press, and nothing put it back when the consent was cancelled. The fix is at the call
 * site — the switch is bound to the session's channel through a getter/setter
 * (release-channel-switch.ts holds the two rules), so it always re-reads the channel and a press
 * only ever asks.
 *
 * Pinned three ways, because each catches what the others cannot: the two rules as pure
 * functions; the page's source, so a later round that quietly drives the switch one-way again
 * fails; and the page MOUNTED, because only a render shows whether the Switch's own copy moved.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sessionPermissions } from "$lib/access/session-permissions.svelte.ts";
import type { SessionBootstrap } from "$lib/matters/matters-api.ts";
import { MANAGE_RELEASE_CHANNEL_PERMISSION } from "$lib/settings/release-channel-api.ts";
import {
  BETA_BRANCH_PLATE_HEADING,
  releaseChannelSwitchChecked,
  releaseChannelSwitchRequest,
} from "$lib/settings/release-channel-switch.ts";
import BetaAccessPage from "./beta-access-harness.svelte";

const PAGE_PATH = join(
  import.meta.dirname,
  "../src/routes/(app)/settings/beta-access/+page.svelte",
);

function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("what the switch reads", () => {
  it("is on only while the firm is actually on beta", () => {
    expect(releaseChannelSwitchChecked("beta")).toBe(true);
    expect(releaseChannelSwitchChecked("stable")).toBe(false);
    expect(releaseChannelSwitchChecked("alpha")).toBe(false);
    expect(releaseChannelSwitchChecked(null)).toBe(false);
  });
});

describe("what a press asks", () => {
  it("asks for consent on the way in and asks nothing on the way out, moving the switch neither way", () => {
    expect(releaseChannelSwitchRequest(true)).toBe("ask-consent");
    expect(releaseChannelSwitchRequest(false)).toBe("leave");
  });
});

describe("the page's source", () => {
  const page = stripComments(readFileSync(PAGE_PATH, "utf8"));

  it("drives the switch through a getter/setter binding, never a one-way checked prop", () => {
    expect(page).toMatch(/<Switch[\s\S]*?bind:checked=\{\(\) => onBeta, requested\}/);
    expect(page).not.toMatch(/<Switch[\s\S]*?\schecked=\{onBeta\}/);
    expect(page).not.toContain("onCheckedChange");
  });

  it("reads the channel from the session and asks through the rule", () => {
    expect(page).toContain("releaseChannelSwitchChecked(channel)");
    expect(page).toContain("releaseChannelSwitchRequest(next)");
  });

  it("heads the plate Beta Branch", () => {
    // Owner ruling, 2026-09-11: "Release Channel" reads "Beta Branch".
    expect(BETA_BRANCH_PLATE_HEADING).toBe("Beta Branch");
    expect(page).toContain("heading={BETA_BRANCH_PLATE_HEADING}");
    expect(page).not.toContain("Release Channel");
  });
});

const STABLE_SESSION = {
  channel: "stable",
  permissions: [MANAGE_RELEASE_CHANNEL_PERMISSION],
  user: { id: "user_1" },
} as unknown as SessionBootstrap;

let target: HTMLElement;
let instance: Record<string, unknown> | undefined;

beforeEach(() => {
  target = document.createElement("div");
  document.body.append(target);
  // The session is already read: the page's own load is a no-op once it has settled.
  sessionPermissions.session = STABLE_SESSION;
  sessionPermissions.settled = true;
  sessionPermissions.failed = false;
  // No write may leave this test. A fetch that is reached is a failure, not a request.
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("nothing on this page may write before the consent is given");
    }),
  );
});

afterEach(() => {
  if (instance !== undefined) unmount(instance);
  instance = undefined;
  target.remove();
  sessionPermissions.session = null;
  sessionPermissions.settled = false;
  vi.unstubAllGlobals();
});

function theSwitch(): HTMLButtonElement {
  const found = target.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (found === null) throw new Error("the page renders no switch");
  return found;
}

describe("the page, mounted: joining the beta and cancelling", () => {
  it("leaves the switch off, because the firm is still on the released build", () => {
    instance = mount(BetaAccessPage, { target });
    flushSync();
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");

    theSwitch().click();
    flushSync();
    // Pressing asked: the consent is open, and nothing was written.
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    // And the switch did not move with the press.
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");

    const cancel = [...(dialog?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.trim() === "Cancel",
    );
    expect(cancel).toBeDefined();
    cancel?.click();
    flushSync();
    expect(theSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("heads its plate Beta Branch", () => {
    instance = mount(BetaAccessPage, { target });
    flushSync();
    expect(target.textContent).toContain("Beta Branch");
    expect(target.textContent).not.toContain("Release Channel");
  });
});
