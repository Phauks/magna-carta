/*
 * The failure presenter, pinned.
 *
 * What matters here is not that a sentence exists. It is that the distinctions the platform paid for
 * survive: that a deploy is never blamed on the member and a missing record is never blamed on a
 * deploy, that a rate limit is not a verdict on what was typed, that a refusal nobody can retry
 * their way out of grows no Retry, and that the two fields naming a way THROUGH produce a way
 * through rather than another apology.
 */
import { describe, expect, it } from "vitest";
import type { Failure, Problem } from "../src/lib/api/problem.ts";
import {
  guidanceForProblem,
  indicatesPlatformTrouble,
  isServiceSkew,
  SERVICE_SKEW_TITLE,
} from "../src/lib/diagnostics/guidance.ts";

function failure(problem: Problem | null): Failure {
  return { problem, request: "GET /matters/mat_1", failedAt: new Date("2026-08-31T21:07:44.318Z") };
}

describe("telling a deploy apart from a missing record", () => {
  it("reads a 404 with no problem document as the releases being out of step", () => {
    // The app only ever calls paths it was built against, and the API registers no notFound
    // handler — so a 404 carrying nothing was answered by no route at all.
    const guidance = guidanceForProblem({ status: 404 });
    expect(guidance.title).toBe(SERVICE_SKEW_TITLE);
    expect(guidance.remedy.kind).toBe("retry");
  });

  it("reads a 404 the API composed as a record that is genuinely gone", () => {
    // The opposite mistake is worse: telling somebody to wait for a release that will not bring
    // their document back.
    const guidance = guidanceForProblem({
      status: 404,
      type: "https://api.magnacarta.esq/problems/not-found",
      errorId: "error_gone",
      detail: "That document is no longer on the matter.",
    });
    expect(guidance.title).not.toBe(SERVICE_SKEW_TITLE);
    expect(guidance.message).toBe("That document is no longer on the matter.");
    // Nothing to press: retrying finds it just as absent.
    expect(guidance.remedy.kind).toBe("none");
  });

  it("needs BOTH marks absent before it calls a 404 skew", () => {
    expect(isServiceSkew({ status: 404 })).toBe(true);
    expect(isServiceSkew({ status: 404, errorId: "error_x" })).toBe(false);
    expect(isServiceSkew({ status: 404, type: "https://example.test/problems/not-found" })).toBe(
      false,
    );
    expect(isServiceSkew({ status: 500 })).toBe(false);
  });
});

describe("the remedy comes from what the server said", () => {
  it("offers a way through when the server says access can be requested", () => {
    const guidance = guidanceForProblem({ status: 403, requestAccess: true });
    expect(guidance.remedy.kind).toBe("requestAccess");
    // Not a danger: nothing is broken, and there is one control that finishes the job.
    expect(guidance.tone).toBe("info");
  });

  it("offers a fresh sign-in when the server says one would work", () => {
    expect(guidanceForProblem({ status: 403, stepUpRequired: true }).remedy.kind).toBe("stepUp");
  });

  it("prefers a way THROUGH over a way round", () => {
    // A step-up and a lockout can arrive together; retrying after the wait would still refuse.
    const guidance = guidanceForProblem({
      status: 429,
      stepUpRequired: true,
      retryAfterSeconds: 30,
    });
    expect(guidance.remedy.kind).toBe("stepUp");
  });

  it("says when rather than failing again immediately", () => {
    const guidance = guidanceForProblem({ status: 429, retryAfterSeconds: 47 });
    expect(guidance.remedy).toEqual({ kind: "retryAfter", seconds: 47 });
  });

  it("grows no control for a refusal that would refuse identically", () => {
    expect(guidanceForProblem({ status: 403 }).remedy.kind).toBe("none");
    expect(guidanceForProblem({ status: 422 }).remedy.kind).toBe("none");
  });

  it("offers a retry for a fault a moment may clear", () => {
    expect(guidanceForProblem({ status: 500 }).remedy.kind).toBe("retry");
    expect(guidanceForProblem({ status: 409 }).remedy.kind).toBe("retry");
    expect(guidanceForProblem(null).remedy.kind).toBe("retry");
  });
});

describe("a rate limit is not a verdict", () => {
  it("never suggests the member sent something wrong", () => {
    const guidance = guidanceForProblem({ status: 429, retryAfterSeconds: 47 });
    expect(guidance.message).toContain("nothing you sent was wrong");
    expect(guidance.tone).toBe("warning");
  });

  it("states the budget the server published, and invents none when it did not", () => {
    expect(guidanceForProblem({ status: 429, attemptsRemaining: 1 }).note).toBe(
      "One attempt remains.",
    );
    expect(guidanceForProblem({ status: 429, attemptsRemaining: 0 }).note).toBe(
      "No attempts remain.",
    );
    expect(guidanceForProblem({ status: 429 }).note).toBeUndefined();
  });
});

describe("the server's own words win", () => {
  it("prefers detail over anything invented here", () => {
    expect(
      guidanceForProblem({ status: 422, detail: "That cost is already billed." }).message,
    ).toBe("That cost is already billed.");
  });

  it("still says something usable when the server said nothing", () => {
    expect(guidanceForProblem({ status: 500 }, "The costs").message.length).toBeGreaterThan(0);
    expect(guidanceForProblem(null).message.length).toBeGreaterThan(0);
  });

  it("distinguishes nothing answering from a refusal", () => {
    expect(guidanceForProblem(null).title).toBe("Couldn't connect");
    expect(guidanceForProblem({ status: 500 }).title).not.toBe("Couldn't connect");
  });
});

describe("what counts as evidence about the platform", () => {
  it("counts skew, faults and silence", () => {
    expect(indicatesPlatformTrouble(failure(null))).toBe(true);
    expect(indicatesPlatformTrouble(failure({ status: 503 }))).toBe(true);
    expect(indicatesPlatformTrouble(failure({ status: 404 }))).toBe(true);
  });

  it("does not count a refusal — that is the access control working", () => {
    expect(indicatesPlatformTrouble(failure({ status: 403 }))).toBe(false);
    expect(indicatesPlatformTrouble(failure({ status: 422 }))).toBe(false);
    expect(indicatesPlatformTrouble(failure({ status: 404, errorId: "error_x", type: "t" }))).toBe(
      false,
    );
  });
});
