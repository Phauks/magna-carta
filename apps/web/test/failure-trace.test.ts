/*
 * The copyable trace, pinned.
 *
 * The property under test is that ONE PASTE IS ENOUGH: a member who copies this and sends it should
 * never be asked a question the screen already knew the answer to. So every field the problem
 * carries has to reach the block, and the fields that are ABSENT have to say so — "error id: (none
 * issued)" is a finding, whereas a missing line is indistinguishable from a truncated paste.
 *
 * The second property is that it never leaks. The breadcrumb trail is shapes, not values, and this
 * pins the sanitizing that keeps it that way.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { Failure } from "../src/lib/api/problem.ts";
import { buildFailureTrace, type TraceEnvironment } from "../src/lib/diagnostics/failure-trace.ts";
import {
  BREADCRUMB_CAPACITY,
  breadcrumbPayload,
  breadcrumbs,
  clearBreadcrumbs,
  record,
} from "../src/lib/diagnostics/breadcrumbs.ts";

const ENVIRONMENT: TraceEnvironment = {
  buildIdentity: "6b4fed0 (production, built 2026-08-31T20:14:02.000Z)",
  route: "/matters/mat_8QK2/costs",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
  language: "en-GB",
  timeZone: "America/Los_Angeles",
  viewport: "1440x900",
  online: true,
  copiedAt: new Date("2026-08-31T21:09:02.001Z"),
};

const FAILED_AT = new Date("2026-08-31T21:07:44.318Z");

function lineFor(trace: string, key: string): string | undefined {
  return trace
    .split("\n")
    .find((line) => line.startsWith(`${key}: `))
    ?.slice(key.length + 2);
}

describe("the trace carries everything a report needs", () => {
  const failure: Failure = {
    request: "GET /matters/mat_8QK2/costs",
    failedAt: FAILED_AT,
    problem: {
      status: 503,
      type: "https://api.magnacarta.esq/problems/upstream-unavailable",
      title: "The costs service is unavailable",
      detail: "The costs could not be read just now.",
      errorId: "error_7FQ2K9XW",
      correlationId: "correlation_01JB9K3M2ZT4",
      attemptsRemaining: 2,
      retryAfterSeconds: 47,
      stepUpRequired: true,
      requestAccess: true,
      instance: "/incidents/inc_1",
      errors: [{ path: "body.amountMinor", code: "out_of_range", detail: "must be above zero" }],
    },
  };

  it("states every field the problem carried", () => {
    const trace = buildFailureTrace(failure, ENVIRONMENT);
    expect(lineFor(trace, "status")).toBe("503");
    expect(lineFor(trace, "problem type")).toBe(
      "https://api.magnacarta.esq/problems/upstream-unavailable",
    );
    expect(lineFor(trace, "title")).toBe("The costs service is unavailable");
    expect(lineFor(trace, "detail")).toBe("The costs could not be read just now.");
    expect(lineFor(trace, "error id")).toBe("error_7FQ2K9XW");
    expect(lineFor(trace, "correlation id")).toBe("correlation_01JB9K3M2ZT4");
    expect(lineFor(trace, "instance")).toBe("/incidents/inc_1");
    expect(lineFor(trace, "attempts remaining")).toBe("2");
    expect(lineFor(trace, "retry after")).toBe("47s");
    expect(lineFor(trace, "step up required")).toBe("yes");
    expect(lineFor(trace, "access can be requested")).toBe("yes");
    expect(trace).toContain("body.amountMinor (out_of_range): must be above zero");
  });

  it("states the environment, which is how a failure gets reproduced", () => {
    const trace = buildFailureTrace(failure, ENVIRONMENT);
    expect(lineFor(trace, "build")).toBe(ENVIRONMENT.buildIdentity);
    expect(lineFor(trace, "route")).toBe("/matters/mat_8QK2/costs");
    expect(lineFor(trace, "request")).toBe("GET /matters/mat_8QK2/costs");
    expect(lineFor(trace, "viewport")).toBe("1440x900");
    expect(lineFor(trace, "time zone")).toBe("America/Los_Angeles");
    expect(lineFor(trace, "network")).toBe("online");
  });

  it("separates when it failed from when it was copied", () => {
    // A failure left on screen keeps reporting the moment it happened, not the moment somebody got
    // round to copying it — which is the difference between finding it in the logs and not.
    const trace = buildFailureTrace(failure, ENVIRONMENT);
    expect(lineFor(trace, "failed")).toBe(FAILED_AT.toISOString());
    expect(lineFor(trace, "copied")).toBe(ENVIRONMENT.copiedAt.toISOString());
  });
});

describe("an absent fact is stated, not dropped", () => {
  it("says so when no handle was issued", () => {
    const trace = buildFailureTrace(
      { request: "GET /x", failedAt: FAILED_AT, problem: { status: 500 } },
      ENVIRONMENT,
    );
    expect(lineFor(trace, "error id")).toBe("(none issued)");
    expect(lineFor(trace, "correlation id")).toBe("(none issued)");
    expect(lineFor(trace, "detail")).toBe("(not stated)");
  });

  it("says so when nothing answered at all", () => {
    const trace = buildFailureTrace(
      { request: "GET /x", failedAt: FAILED_AT, problem: null },
      { ...ENVIRONMENT, online: false },
    );
    expect(trace).toContain("nothing answered");
    expect(lineFor(trace, "network")).toBe("offline");
  });

  it("says so when nobody's call provoked the report", () => {
    // The help-menu reporter has no failing call, and inventing a request line would put a wrong
    // fact in a block built to be pasted into a report.
    const trace = buildFailureTrace(null, ENVIRONMENT);
    expect(trace).toContain("reported by hand");
    expect(lineFor(trace, "build")).toBe(ENVIRONMENT.buildIdentity);
  });
});

describe("breadcrumbs are shapes, never values", () => {
  beforeEach(() => clearBreadcrumbs());

  it("redacts an email address that found its way into a label", () => {
    record("navigation", "opened joan@example.test's contact", "/directory/ent_1");
    expect(breadcrumbs()[0]?.label).toContain("[redacted]");
    expect(breadcrumbs()[0]?.label).not.toContain("joan@example.test");
  });

  it("caps a label rather than letting somebody log content through it", () => {
    record("action", "x".repeat(500));
    expect(breadcrumbs()[0]?.label.length).toBeLessThanOrEqual(120);
  });

  it("keeps only the most recent, so nothing lingers from earlier unrelated work", () => {
    for (let index = 0; index < BREADCRUMB_CAPACITY + 10; index += 1) {
      record("action", `step ${String(index)}`);
    }
    const trail = breadcrumbs();
    expect(trail).toHaveLength(BREADCRUMB_CAPACITY);
    expect(trail[trail.length - 1]?.label).toBe(`step ${String(BREADCRUMB_CAPACITY + 9)}`);
  });

  it("sends the shape the incident route accepts", () => {
    record("request", "GET /matters", "/matters");
    const [payload] = breadcrumbPayload();
    expect(payload).toMatchObject({ action: "request: GET /matters", route: "/matters" });
    expect(payload?.action.length).toBeLessThanOrEqual(120);
    expect(payload?.route.length).toBeLessThanOrEqual(200);
  });

  it("reaches the trace, so a report says what led up to the failure", () => {
    record("navigation", "opened the Costs tab", "/matters/mat_8QK2/costs");
    const trace = buildFailureTrace(
      { request: "GET /x", failedAt: FAILED_AT, problem: { status: 500 } },
      ENVIRONMENT,
      breadcrumbs(),
    );
    expect(trace).toContain("breadcrumbs (oldest first)");
    expect(trace).toContain("navigation: opened the Costs tab");
  });
});
