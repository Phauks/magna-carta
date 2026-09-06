// @vitest-environment happy-dom
/*
 * The matter header's one create control: what the registry answers, and how a section takes the
 * control and gives it back.
 *
 * The control's label is settled by the section registry, so the first half pins the registry's
 * contract — every section answers, a noun fits the fixed width, a declining section carries its
 * line. The second half pins the slot: one claimant at a time, a rival refused loudly, and — the
 * assumption the refusal rests on — that swapping one page for another the way navigation does
 * releases the old claim before the new one lands. If that ordering ever changed, every move
 * between sections would throw, and this is the test that would say so first.
 */
import { flushSync, mount, unmount } from "svelte";
import { describe, expect, it } from "vitest";
import {
  assertCreateNoun,
  CREATE_NOUN_MAX_LENGTH,
  createLabel,
} from "@magna-carta/design-system/create-label";
import { honouredClaim, MatterCreateSlot } from "$lib/matters/create-action.svelte.ts";
import { CREATE_SEVERAL_KINDS, matterSections } from "$lib/matters/sections.ts";
import Harness from "./create-claim-harness.svelte";

describe("every matter section answers for the create control", () => {
  it("declares a noun that fits the control, several kinds, or declines with a line", () => {
    for (const section of matterSections) {
      // A section that makes several kinds reads the bare "New" and names them on its menu items,
      // so it declares no noun to check and owes no reason — it creates plenty.
      if (section.createNoun === CREATE_SEVERAL_KINDS) continue;
      if (section.createNoun === null) {
        expect(section.createWaitingOn, `${section.slug} declines without a reason`).toBeTruthy();
        continue;
      }
      expect(() => assertCreateNoun(section.createNoun ?? "")).not.toThrow();
      expect(createLabel(section.createNoun)).toBe(`New ${section.createNoun}`);
    }
  });

  it("gives the calendar the bare New, because it makes two kinds", () => {
    // The label would otherwise name one of them and be wrong about the other: the control read
    // "New Event" over a menu that also records a deadline.
    const calendar = matterSections.find((section) => section.slug === "calendar");
    expect(calendar?.createNoun).toBe(CREATE_SEVERAL_KINDS);
    // The sentinel is not a noun, so it can never be mistaken for one.
    expect(() => assertCreateNoun(CREATE_SEVERAL_KINDS)).toThrow(/one capitalised word/u);
  });

  it("reads the same noun for the sections the owner named", () => {
    const nounOf = (slug: string) =>
      matterSections.find((section) => section.slug === slug)?.createNoun;
    expect(nounOf("fees")).toBe("Fee");
    expect(nounOf("costs")).toBe("Cost");
    expect(nounOf("files")).toBe("File");
  });

  it("refuses a noun the fixed width cannot hold, or that is not one word", () => {
    expect(() => assertCreateNoun("Fee Note")).toThrow(/one capitalised word/u);
    expect(() => assertCreateNoun("fee")).toThrow(/one capitalised word/u);
    expect(() => assertCreateNoun("Fees")).not.toThrow();
    expect(() => assertCreateNoun("A".repeat(1) + "b".repeat(CREATE_NOUN_MAX_LENGTH))).toThrow(
      /fixed width holds/u,
    );
  });
});

describe("the slot holds one claim", () => {
  const claimFor = (section: string) => ({ section, title: section, run: () => {} });

  it("is empty until a page claims it, and empty again once the page lets go", () => {
    const slot = new MatterCreateSlot();
    const owner = Symbol("fees");
    expect(slot.held).toBeNull();
    slot.claim(owner, claimFor("fees"));
    expect(slot.held?.section).toBe("fees");
    slot.release(owner);
    expect(slot.held).toBeNull();
  });

  it("lets the same owner restate its claim, and ignores a release from a stranger", () => {
    const slot = new MatterCreateSlot();
    const owner = Symbol("fees");
    slot.claim(owner, claimFor("fees"));
    slot.claim(owner, { ...claimFor("fees"), refusal: "Not now." });
    expect(slot.held?.refusal).toBe("Not now.");
    slot.release(Symbol("someone else"));
    expect(slot.held?.section).toBe("fees");
    expect(slot.holderCount).toBe(1);
  });

  it("refuses a second claimant while the first still holds the control", () => {
    const slot = new MatterCreateSlot();
    slot.claim(Symbol("fees"), claimFor("fees"));
    expect(() => slot.claim(Symbol("costs"), claimFor("costs"))).toThrow(/already claimed/u);
  });
});

describe("a page swap hands the control over without a moment of two claimants", () => {
  function mountHarness() {
    const target = document.createElement("div");
    document.body.append(target);
    let slot: MatterCreateSlot | null = null;
    const harness = mount(Harness, {
      target,
      props: {
        onSlot: (provided) => {
          slot = provided;
        },
      },
    });
    flushSync();
    if (slot === null) throw new Error("the harness provided no slot");
    return { harness, slot: slot as MatterCreateSlot, target };
  }

  it("moves the claim from the leaving section to the arriving one", () => {
    const { harness, slot, target } = mountHarness();
    expect(slot.held?.section).toBe("fees");
    expect(slot.holderCount).toBe(1);

    harness.show("costs");
    flushSync();
    expect(slot.held?.section).toBe("costs");
    expect(slot.holderCount).toBe(1);

    harness.show("notes");
    flushSync();
    expect(slot.held?.section).toBe("notes");
    expect(slot.holderCount).toBe(1);

    unmount(harness);
    flushSync();
    expect(slot.held).toBeNull();
    target.remove();
  });

  it("still refuses a genuine second claimant on one screen", () => {
    const { harness, target } = mountHarness();
    expect(() => {
      harness.double();
      flushSync();
    }).toThrow(/already claimed/u);
    target.remove();
  });
});

describe("the control honours only the claim for the section on screen", () => {
  const feesClaim = { section: "fees", title: "New fee", run: () => undefined } as const;

  it("honours a claim that answers for the section the reader is standing on", () => {
    expect(honouredClaim(feesClaim, "fees")).toBe(feesClaim);
  });

  it("ignores the claim of the section just left, which every navigation passes through", () => {
    /*
     * The regression: leaving Files for Parties updates the address before the outgoing page's
     * effect cleanup releases its claim, so for one flush the control is asked about a claim for
     * "files" while the reader is on "parties". This threw, which crashed the screen on every tab
     * change. It reads as unclaimed instead — which is what the control already shows in the moment
     * before a section claims.
     */
    expect(honouredClaim({ ...feesClaim, section: "files" }, "parties")).toBeNull();
  });

  it("ignores every claim on a screen the registry does not name", () => {
    expect(honouredClaim(feesClaim, undefined)).toBeNull();
  });

  it("has nothing to honour while no section holds the control", () => {
    expect(honouredClaim(null, "fees")).toBeNull();
  });
});
