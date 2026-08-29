/*
 * The version overlay's honesty rules, exercised on the pure model: a placeholder identity never
 * claims a skew, every non-answer keeps its own name, a cached observation states its age once it
 * has one, and a copied identifier line carries only what was actually known.
 */
import { describe, expect, it } from "vitest";
import {
  buildsDiffer,
  copyLineForPart,
  describeObservationAge,
  formatVersionTimestamp,
  isRealCommit,
  serviceStateLabel,
  versionChipLabel,
} from "../src/lib/versions/version-overlay-model.ts";

describe("what counts as a real commit", () => {
  it("accepts a short hash and rejects every honest placeholder", () => {
    expect(isRealCommit("f4b6d82")).toBe(true);
    expect(isRealCommit("dev")).toBe(false);
    expect(isRealCommit("unknown")).toBe(false);
    expect(isRealCommit("")).toBe(false);
    expect(isRealCommit(null)).toBe(false);
  });

  it("the chip shows the commit, or dev when the build has no identity", () => {
    expect(versionChipLabel("f4b6d82")).toBe("f4b6d82");
    expect(versionChipLabel("unknown")).toBe("dev");
    expect(versionChipLabel("dev")).toBe("dev");
  });
});

describe("the web-versus-API skew call", () => {
  it("two different real commits are a skew", () => {
    expect(buildsDiffer("f4b6d82", "a1b2c3d")).toBe(true);
  });

  it("the same commit on both sides is not", () => {
    expect(buildsDiffer("f4b6d82", "f4b6d82")).toBe(false);
  });

  it("a placeholder on either side says no identity, never a different identity", () => {
    expect(buildsDiffer("unknown", "a1b2c3d")).toBe(false);
    expect(buildsDiffer("f4b6d82", "dev")).toBe(false);
    expect(buildsDiffer("f4b6d82", null)).toBe(false);
  });
});

describe("the honest non-answers", () => {
  it("each state keeps its own name and a reported row carries none", () => {
    expect(serviceStateLabel("reported")).toBeNull();
    expect(serviceStateLabel("unbound")).toBe("Not deployed");
    expect(serviceStateLabel("unreachable")).toBe("Unreachable");
    expect(serviceStateLabel("unreported")).toBe("Not reporting");
  });
});

describe("the observation's age", () => {
  const observedAt = "2026-08-29T12:00:00.000Z";

  it("stays silent while fresh", () => {
    expect(describeObservationAge(observedAt, Date.parse(observedAt) + 4000)).toBeNull();
  });

  it("speaks in seconds once the cache could be showing", () => {
    expect(describeObservationAge(observedAt, Date.parse(observedAt) + 40_000)).toBe(
      "checked 40 seconds ago",
    );
  });

  it("rolls over to minutes for an old observation", () => {
    expect(describeObservationAge(observedAt, Date.parse(observedAt) + 120_000)).toBe(
      "checked 2 minutes ago",
    );
  });

  it("says nothing about a timestamp it cannot parse", () => {
    expect(describeObservationAge("not a timestamp", Date.now())).toBeNull();
  });
});

describe("the copied identifier line", () => {
  it("carries the part, the commit, and both timestamps when known", () => {
    expect(
      copyLineForPart({
        label: "API",
        commit: "a1b2c3d",
        commitTime: "2026-08-29T10:00:00Z",
        buildTime: "2026-08-29T10:05:00Z",
      }),
    ).toBe("API: a1b2c3d · committed 2026-08-29T10:00:00Z · built 2026-08-29T10:05:00Z");
  });

  it("omits what was not known instead of inventing it", () => {
    expect(
      copyLineForPart({ label: "Web App", commit: "dev", commitTime: null, buildTime: null }),
    ).toBe("Web App: dev");
  });
});

describe("timestamp rendering", () => {
  it("passes null through and refuses garbage", () => {
    expect(formatVersionTimestamp(null)).toBeNull();
    expect(formatVersionTimestamp("not a date")).toBeNull();
  });

  it("renders a parseable instant", () => {
    expect(formatVersionTimestamp("2026-08-29T10:00:00Z")).not.toBeNull();
  });
});
