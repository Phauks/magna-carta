import { describe, expect, it } from "vitest";
import { newIdentifier } from "@magna-carta/identifiers/generate";
import { z } from "zod";
import * as contract from "../src/contract.ts";

// The contract module is the calendar's one home for what its API accepts and returns. Two things
// have to hold for that to be true rather than asserted: every shape it exports is a named component
// (an unnamed one would inline into the document wherever it is used, and the name is the only thing
// that makes a shape one fact across the routes that share it), and no two shapes claim one name (the
// emitter overwrites silently on a duplicate). The parse cases below pin the rules the shapes carry
// that a service depends on — a date is a civil date, an identifier is well formed — so a change to
// the shape that would let a malformed body through fails here, without booting the worker.

const shapes = Object.entries(contract as Record<string, unknown>).filter(
  (entry): entry is [string, z.ZodType] => entry[1] instanceof z.ZodType,
);

describe("the calendar contract", () => {
  it("exports named components only, each name unique", () => {
    const names = new Map<string, string>();
    for (const [exportName, shape] of shapes) {
      const id = shape.meta()?.id;
      expect({ exportName, id }).toEqual({ exportName, id: expect.any(String) });
      expect({ exportName, first: names.get(id ?? "") }).toEqual({ exportName, first: undefined });
      names.set(id ?? "", exportName);
    }
    expect(shapes.length).toBeGreaterThan(40);
  });

  it("accepts a well-formed event and refuses a date that is not a civil date", () => {
    const body = {
      title: "Motion hearing",
      startsOn: "2026-10-02",
      startsAtTime: "09:30",
      timeZone: "America/Denver",
    };
    expect(contract.CreateEventRequest.safeParse(body).success).toBe(true);
    expect(contract.CreateEventRequest.safeParse({ ...body, startsOn: "October 2" }).success).toBe(
      false,
    );
    expect(contract.CreateEventRequest.safeParse({ ...body, startsAtTime: "9:30" }).success).toBe(
      false,
    );
  });

  it("refuses a malformed identifier in a body field and accepts a well-formed one", () => {
    const base = {
      title: "Answer due",
      dueOn: "2026-10-30",
      timeZone: "America/Denver",
    };
    expect(
      contract.CreateDeadlineRequest.safeParse({ ...base, triggerEventId: "not-a-handle" }).success,
    ).toBe(false);
    const parsed = contract.CreateDeadlineRequest.safeParse({
      ...base,
      triggerEventId: newIdentifier("matterEvent"),
    });
    expect(parsed.success).toBe(true);
  });

  it("answers a page envelope with an explicit nextCursor, never an omitted one", () => {
    expect(contract.MatterEventPage.safeParse({ data: [], nextCursor: null }).success).toBe(true);
    expect(contract.MatterEventPage.safeParse({ data: [] }).success).toBe(false);
  });
});
