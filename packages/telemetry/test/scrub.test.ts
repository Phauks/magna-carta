import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../src/event.ts";
import { scrubStrings } from "../src/scrub.ts";

function eventWith(fields: TelemetryEvent["fields"]): TelemetryEvent {
  return { name: "test.event", at: "2026-06-13T00:00:00.000Z", correlationId: "cor_abc", fields };
}

describe("scrubStrings — the backstop tripwire", () => {
  it("scrubs a planted email address and trips on its field", () => {
    const { event, trips } = scrubStrings(
      eventWith({ messageHead: "contact jane.doe+x@example.co.uk now" }),
    );
    expect(event.fields.messageHead).toBe("contact [scrubbed] now");
    expect(trips).toEqual([{ field: "messageHead" }]);
  });

  it("scrubs a planted SSN shape and trips", () => {
    const { event, trips } = scrubStrings(eventWith({ detail: "ssn 123-45-6789 on file" }));
    expect(event.fields.detail).toBe("ssn [scrubbed] on file");
    expect(trips).toEqual([{ field: "detail" }]);
  });

  it("scrubs a long digit run (account-number shape) and trips", () => {
    const { event, trips } = scrubStrings(eventWith({ note: "acct 1234567890123 closed" }));
    expect(event.fields.note).toBe("acct [scrubbed] closed");
    expect(trips).toEqual([{ field: "note" }]);
  });

  it("leaves a clean event untouched with zero trips", () => {
    const clean = eventWith({ route: "/api/v1/matters/:id", status: 200, ok: true, none: null });
    const { event, trips } = scrubStrings(clean);
    expect(event.fields).toEqual({
      route: "/api/v1/matters/:id",
      status: 200,
      ok: true,
      none: null,
    });
    expect(trips).toEqual([]);
  });

  it("does NOT trip on err_/cor_ handle-shaped values (letters+digits, no 9-digit run)", () => {
    const { event, trips } = scrubStrings(
      eventWith({ errorId: "err_V1StGXR8Z5jdHiopq2Cf", correlationId: "cor_4n2K7pQ9wXb" }),
    );
    expect(trips).toEqual([]);
    expect(event.fields.errorId).toBe("err_V1StGXR8Z5jdHiopq2Cf");
    expect(event.fields.correlationId).toBe("cor_4n2K7pQ9wXb");
  });

  it("EXEMPTS a whole minted handle whose body has a dash-flanked digit run — never corrupts the Error ID", () => {
    // A real 21-char token can contain a dash-flanked 9+ digit run; without the handle exemption the
    // digit-run pattern would scrub it to [scrubbed], destroying the correlation handle and tripping.
    const { event, trips } = scrubStrings(eventWith({ errorId: "err_aa-123456789-bbbbbbbb" }));
    expect(trips).toEqual([]);
    expect(event.fields.errorId).toBe("err_aa-123456789-bbbbbbbb");
  });

  it("still scrubs a dash-flanked digit run in a NON-handle value (the exemption is precise)", () => {
    const { event, trips } = scrubStrings(eventWith({ note: "ref-123456789-x end" }));
    expect(event.fields.note).toBe("ref-[scrubbed]-x end");
    expect(trips).toEqual([{ field: "note" }]);
  });

  it("trips once per offending field and scrubs every match within it", () => {
    const { event, trips } = scrubStrings(
      eventWith({ a: "a@b.com and c@d.com", b: "fine", c: "ssn 111-22-3333" }),
    );
    expect(event.fields.a).toBe("[scrubbed] and [scrubbed]");
    expect(event.fields.c).toBe("ssn [scrubbed]");
    expect(trips).toEqual([{ field: "a" }, { field: "c" }]);
  });

  it("does not mutate the input event (returns a fresh fields object)", () => {
    const input = eventWith({ messageHead: "x@y.com" });
    scrubStrings(input);
    expect(input.fields.messageHead).toBe("x@y.com");
  });
});
