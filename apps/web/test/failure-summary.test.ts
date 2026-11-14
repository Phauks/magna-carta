/*
 * The line every failure leads with: area, action, kind of failure. Built only from code-shaped
 * facts, so these cases pin both the wording and that nothing beyond a path's shape is read.
 */
import { describe, expect, it } from "vitest";
import type { Failure } from "../src/lib/api/problem.ts";
import {
  actionForRequest,
  areaForPath,
  causeLabel,
  failureSummary,
} from "../src/lib/diagnostics/failure-summary.ts";

const AT = new Date("2026-11-14T00:06:18Z");

describe("areaForPath", () => {
  it("names the area from an API template, a request line or an app route", () => {
    expect(areaForPath("POST /api/v1/meetings/:meetingId/join")).toBe("Meetings");
    expect(areaForPath("GET /matters/mat_8QK2/costs")).toBe("Matters");
    expect(areaForPath("PAGE /trust/accounts")).toBe("Trust");
    expect(areaForPath("/(app)/time-entries")).toBe("Time");
  });

  it("says the segment itself for an area it has no word for, and nothing for no path", () => {
    expect(areaForPath("GET /widgets")).toBe("Widgets");
    expect(areaForPath("GET /")).toBeNull();
  });
});

describe("actionForRequest", () => {
  it("reads an action taken on a record", () => {
    expect(actionForRequest("POST /api/v1/meetings/:meetingId/join")).toBe("Join meeting");
    expect(actionForRequest("POST /matters/mat_8QK2/close")).toBe("Close matter");
  });

  it("reads a plain read, create, change or delete", () => {
    expect(actionForRequest("GET /api/v1/costs")).toBe("Read costs");
    expect(actionForRequest("PATCH /api/v1/matters/:id")).toBe("Change matter");
    expect(actionForRequest("DELETE /api/v1/task-lists/:id")).toBe("Delete task list");
    expect(actionForRequest("POST /api/v1/meetings/:meetingId/polls")).toBe("Create poll");
  });
});

describe("causeLabel", () => {
  it("tells a server fault, a refusal, no answer and an app crash apart", () => {
    const server: Failure = {
      problem: { status: 500, cause: "TypeError: Cannot read properties of undefined" },
      request: "POST /meetings/m_1/join",
      failedAt: AT,
    };
    expect(causeLabel(server)).toBe("Server fault: TypeError");
    expect(
      causeLabel({ problem: { status: 403, title: "Forbidden" }, request: "GET /x", failedAt: AT }),
    ).toBe("Refused (403): Forbidden");
    expect(causeLabel({ problem: null, request: "GET /x", failedAt: AT })).toBe(
      "No answer from the server",
    );
    expect(
      causeLabel({
        problem: { status: 500 },
        request: "PAGE /meetings/room",
        failedAt: AT,
        cause: "TypeError: x is not a function at stage.svelte:1:2",
      }),
    ).toBe("App fault: TypeError");
  });
});

describe("failureSummary", () => {
  it("prefers the operation the server matched over the concrete request", () => {
    expect(
      failureSummary({
        problem: {
          status: 500,
          operation: "POST /api/v1/meetings/:meetingId/join",
          cause: "TypeError: boom",
        },
        request: "POST /meetings/meeting_ABC/join",
        failedAt: AT,
      }),
    ).toEqual(["Meetings", "Join meeting", "Server fault: TypeError"]);
  });

  it("leaves the action off a crash, which has no request", () => {
    expect(
      failureSummary({
        problem: { status: 500 },
        request: "PAGE /meetings/room",
        failedAt: AT,
        cause: "RangeError: Invalid time value",
      }),
    ).toEqual(["Meetings", "App fault: RangeError"]);
  });
});
