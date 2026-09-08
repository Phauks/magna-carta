/*
 * The waiting screen's sequence. What is pinned here is the thing the sequence exists for: that a
 * person waiting on a workspace can tell WHICH part of it is being made, and — more importantly —
 * that the wait does not end one step early.
 *
 * The bug this closes was invisible from the screen it broke. A firm becomes active in the control
 * plane before the member record mirroring its owner into the firm's own database has landed, and a
 * screen that treated the firm's existence as "ready" handed somebody a workspace where every screen
 * refused. So the completion rule and the last step are asserted directly, and separately from the
 * four steps ahead of them.
 */
import { describe, expect, it } from "vitest";
import {
  FIRM_BUILD_UNREPORTED,
  firmBuildComplete,
  firmBuildStalled,
  firmBuildSteps,
  firmBuiltReading,
  stalledStepFailure,
  type FirmBuildReading,
} from "../src/lib/auth/firm-build-progress.ts";

/** A reading part-way through the build, so each test names only what it is changing. */
function reading(overrides: Partial<FirmBuildReading> = {}): FirmBuildReading {
  return { ...FIRM_BUILD_UNREPORTED, ...overrides };
}

const statuses = (value: FirmBuildReading): string[] =>
  firmBuildSteps(value).map((step) => step.status);

describe("the build sequence", () => {
  it("names five steps, in the order the platform performs them", () => {
    // The count is the contract with the screen: four steps make the firm and the fifth admits the
    // person to it. A sequence that lost the fifth would be reporting a finished build to somebody
    // who cannot use it, which is the failure this whole surface exists to prevent.
    expect(firmBuildSteps(FIRM_BUILD_UNREPORTED).map((step) => step.label)).toEqual([
      "Creating your firm's record",
      "Setting up your firm's document storage",
      "Generating your firm's encryption key",
      "Opening your firm's workspace",
      "Adding you to the firm",
    ]);
  });

  it("marks exactly one step as in flight — the first that has not happened", () => {
    // Not two, and not none. The active marker is what a person watches; a sequence with several
    // would be claiming work is happening in parallel that happens in order.
    expect(statuses(FIRM_BUILD_UNREPORTED)).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(statuses(reading({ firmRecord: true, fileStorage: true }))).toEqual([
      "done",
      "done",
      "active",
      "pending",
      "pending",
    ]);
  });

  it("shows the last step in flight once the firm itself is made", () => {
    // The gap. The firm is active — every step that makes it is behind — and the person still
    // cannot use it, so the sequence has somewhere honest to point.
    expect(statuses(firmBuiltReading({ memberRecord: false }))).toEqual([
      "done",
      "done",
      "done",
      "done",
      "active",
    ]);
    expect(statuses(firmBuiltReading({ memberRecord: true }))).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("fails the step a stopped build stopped on, rather than leaving it looking busy", () => {
    // A dead-lettered row is the one state on this screen that waiting will not clear, so the step
    // says so and says it INSTEAD of its own label — one sentence in the sequence, not a struck-out
    // step plus an error somewhere else on the card.
    const steps = firmBuildSteps(reading({ firmRecord: true, stalled: true }));
    expect(steps.map((step) => step.status)).toEqual([
      "done",
      "failed",
      "pending",
      "pending",
      "pending",
    ]);
    // The failure sentence NAMES the step, because the component shows it instead of the label — a
    // sequence that says a step stopped and no longer says which one has dropped the one fact
    // somebody has to give support.
    expect(steps[1]?.failure).toBe(stalledStepFailure("Setting up your firm's document storage"));
    expect(steps[1]?.failure).toContain("Setting up your firm's document storage");
    // The steps still to come are NOT failed: the build never reached them, and marking them so
    // would claim work had been attempted and lost.
    expect(steps.slice(2).every((step) => step.failure === undefined)).toBe(true);
  });
});

describe("the invitee's wait, which shares only the last step", () => {
  it("shows only the step that is theirs", () => {
    // Four ticks against a firm that has existed for years would be filler, and the heading and the
    // sequence have to agree: neither claims a workspace is being built for somebody being let into
    // one that already works.
    expect(firmBuildSteps(firmBuiltReading({ memberRecord: false }), "joining")).toEqual([
      { label: "Adding you to the firm", status: "active" },
    ]);
    expect(firmBuildSteps(firmBuiltReading({ memberRecord: true }), "joining")).toEqual([
      { label: "Adding you to the firm", status: "done" },
    ]);
  });

  it("names a member record that has been given up on, on either wait", () => {
    // The mirror of a dead-lettered build, one step further on. Without it the screen would tell
    // somebody to keep waiting for a message the relay has stopped retrying.
    const abandoned = firmBuiltReading({ memberRecord: false, memberRecordStalled: true });
    expect(firmBuildStalled(abandoned)).toBe(true);
    expect(firmBuildSteps(abandoned, "joining")).toEqual([
      {
        label: "Adding you to the firm",
        status: "failed",
        failure: stalledStepFailure("Adding you to the firm"),
      },
    ]);
    expect(statuses(abandoned)).toEqual(["done", "done", "done", "done", "failed"]);
  });
});

describe("when the wait is over", () => {
  it("is not over while the firm exists and the account has not been admitted to it", () => {
    // The whole bug, as one assertion: an active firm is not a finished join.
    expect(firmBuildComplete(firmBuiltReading({ memberRecord: false }))).toBe(false);
  });

  it("is over only when both the firm and this account's place in it exist", () => {
    expect(firmBuildComplete(firmBuiltReading({ memberRecord: true }))).toBe(true);
    // A member record cannot arrive before the firm is active — the message that writes it is
    // composed by the activation batch — but the rule is stated over both facts rather than over
    // the one that happens to be sufficient today.
    expect(firmBuildComplete(reading({ memberRecord: true }))).toBe(false);
  });
});
