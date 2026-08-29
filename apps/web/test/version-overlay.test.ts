/*
 * The version overlay's honesty rules, exercised on the pure model: a placeholder identity never
 * claims a skew, every non-answer keeps its own name, a cached observation states its age once it
 * has one, and a copied identifier line carries only what was actually known.
 *
 * The scope rules are asserted twice over. The decision itself is a pure function and is tested as
 * one; that the component actually obeys it is read off the component's source, because this
 * project's tests run in a plain node pool and rendering a design-system component pulls bits-ui,
 * which a deliberate boundary gate keeps out of every config outside the design system
 * (packages/design-system/test/fitness/boundaries.test.ts). What matters most is negative — that a
 * signed-out panel issues no authenticated request at all — and a source assertion states it for
 * every path into the call rather than only the one a render happened to exercise.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildsDiffer,
  copyLineForPart,
  describeObservationAge,
  formatVersionTimestamp,
  isRealCommit,
  readsServiceAggregate,
  serviceStateLabel,
  versionChipLabel,
  SIGNED_OUT_ESTATE_NOTICE,
} from "../src/lib/versions/version-overlay-model.ts";

const SOURCE_ROOT = join(import.meta.dirname, "../src");

function source(relativePath: string): string {
  return readFileSync(join(SOURCE_ROOT, relativePath), "utf8");
}

/** Strip comment prose so a sweep reads only what the component does, never what it explains. */
function stripComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

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

describe("what each scope is allowed to read", () => {
  it("only a session may read the aggregate", () => {
    expect(readsServiceAggregate("app")).toBe(true);
    expect(readsServiceAggregate("public")).toBe(false);
  });

  it("the signed-out line names the boundary rather than implying a fault", () => {
    expect(SIGNED_OUT_ESTATE_NOTICE).toContain("signed in");
    expect(SIGNED_OUT_ESTATE_NOTICE).not.toMatch(/fail|error|unavailable|unreachable/i);
    // Owner ruling, docs/conventions/design-corrections.md: no em dashes in user-facing copy.
    expect(SIGNED_OUT_ESTATE_NOTICE).not.toContain("—");
  });
});

describe("the chip in its public scope", () => {
  const chip = stripComments(source("lib/versions/version-chip.svelte"));

  it("reads the aggregate from exactly one place, and that place refuses the public scope", () => {
    const calls = chip.match(/requestJson</g) ?? [];
    expect(calls).toHaveLength(1);
    const refreshBody = /async function refresh\(\): Promise<void> \{([\s\S]*?)\n  \}/.exec(chip);
    expect(refreshBody).not.toBeNull();
    const body = refreshBody?.[1] ?? "";
    expect(body).toContain("if (!readsAggregate) return;");
    // The guard precedes the call, so no path through the function reaches the network first.
    expect(body.indexOf("if (!readsAggregate) return;")).toBeLessThan(body.indexOf("requestJson<"));
  });

  it("never opens the read on a public panel, however the panel was opened", () => {
    expect(chip).toContain("if (!open || !readsAggregate) return;");
  });

  it("shows this build's own identity unconditionally, from the baked-in stamp", () => {
    // The Web App row sits outside every `value`/`loading` branch: it comes from the bundle, so it
    // renders in both scopes and with the API unreachable.
    const webAppRow = /\{@render partRow\(\{\s*label: "Web App",[\s\S]*?\}\)\}/.exec(chip);
    expect(webAppRow).not.toBeNull();
    expect(webAppRow?.[0]).toContain("BUILD_IDENTITY.committedAt");
    expect(chip.indexOf("Web App")).toBeLessThan(chip.indexOf("{#if value !== null}"));
  });

  it("says out loud what the public panel is not showing", () => {
    expect(chip).toMatch(/\{#if !readsAggregate\}[\s\S]*SIGNED_OUT_ESTATE_NOTICE[\s\S]*\{\/if\}/);
  });
});

describe("where the public chip is mounted", () => {
  const frame = source("lib/auth/auth-frame.svelte");

  it("rides the shared signed-out frame, in its chrome corner, in the public scope", () => {
    // One mount covers every surface the frame wraps: sign in, password reset, and the joining
    // screens. Pasting the chip into each screen would let them drift apart.
    expect(frame).toContain('<VersionChip scope="public" />');
    expect(stripComments(frame)).toMatch(
      /<TopBar\.Actions>[\s\S]*<VersionChip[\s\S]*<\/TopBar\.Actions>/,
    );
  });

  it("leads the actions cluster on BOTH surfaces, so it does not move on sign-in", () => {
    /*
     * Owner correction, 2026-08-29: "put build versions to the left of those buttons." The chip is
     * the FIRST thing in the trailing cluster on the signed-out frame and on the app shell alike —
     * the buttons beside it differ (ecosystem links there, bell/timer/profile here) but its seat
     * does not. Asserted on both files together because the defect this prevents is the two
     * drifting apart, which no single-file check would see.
     */
    for (const path of ["lib/auth/auth-frame.svelte", "lib/components/app-shell.svelte"]) {
      const actions = /<TopBar\.Actions>([\s\S]*?)<\/TopBar\.Actions>/.exec(
        stripComments(source(path)),
      );
      expect(actions, path).not.toBeNull();
      const firstElement = /<([A-Za-z][\w.]*)/.exec(actions?.[1] ?? "");
      expect(firstElement?.[1], path).toBe("VersionChip");
    }
  });

  it("is the frame every signed-out surface is cut from", () => {
    const surfaces = [
      "routes/login/+page.svelte",
      "routes/login/reset-password/+page.svelte",
      "routes/register/+page.svelte",
      "routes/register/firm/+page.svelte",
      "routes/register/invitation/+page.svelte",
      "routes/register/confirm/+page.svelte",
      "lib/auth/auth-placeholder.svelte",
    ];
    for (const surface of surfaces) {
      expect(source(surface), surface).toContain("auth-frame.svelte");
    }
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
