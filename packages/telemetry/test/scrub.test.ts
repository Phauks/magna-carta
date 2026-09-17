import { makeTokenGenerator, TOKEN_SIZE } from "@magna-carta/identifiers/token";
import { describe, expect, it } from "vitest";
import type { TelemetryEvent } from "../src/event.ts";
import { scrubStrings, scrubText } from "../src/scrub.ts";

function eventWith(fields: TelemetryEvent["fields"]): TelemetryEvent {
  return {
    name: "test.event",
    at: "2026-06-13T00:00:00.000Z",
    correlationId: "correlation_abc",
    fields,
  };
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

  it("does NOT trip on error_/correlation_ handle-shaped values (letters+digits, no 9-digit run)", () => {
    const { event, trips } = scrubStrings(
      eventWith({
        errorId: "error_V1StGXR8Z5jdHiopq2Cf",
        correlationId: "correlation_4n2K7pQ9wXb",
      }),
    );
    expect(trips).toEqual([]);
    expect(event.fields.errorId).toBe("error_V1StGXR8Z5jdHiopq2Cf");
    expect(event.fields.correlationId).toBe("correlation_4n2K7pQ9wXb");
  });

  it("EXEMPTS a whole minted handle whose body has a dash-flanked digit run — never corrupts the Error ID", () => {
    // A real 21-char token can contain a dash-flanked 9+ digit run; without the handle exemption the
    // digit-run pattern would scrub it to [scrubbed], destroying the correlation handle and tripping.
    const { event, trips } = scrubStrings(eventWith({ errorId: "error_aa-123456789-bbbbbbbb" }));
    expect(trips).toEqual([]);
    expect(event.fields.errorId).toBe("error_aa-123456789-bbbbbbbb");
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

// Planted-PII coverage for the shapes people actually WRITE. messageHead is the one free-text field
// in the catalog — the first slice of an error message, which is where a user's own typing ends up —
// and the unbroken-digit-run pattern only ever caught a number pasted as one uninterrupted string.
describe("scrubStrings — separated digit groups in the one free-text field", () => {
  const cardShapes = [
    ["space-separated 16-digit", "charge failed for 4111 1111 1111 1111 today"],
    ["dash-separated 16-digit", "charge failed for 4111-1111-1111-1111 today"],
    ["American Express 4-6-5", "charge failed for 3782 822463 10005 today"],
    ["dash-separated 12-digit", "charge failed for 4111-1111-1111 today"],
    ["19-digit five groups", "charge failed for 4111 1111 1111 1111 111 today"],
  ] as const;

  for (const [label, planted] of cardShapes) {
    it(`scrubs a ${label} card number and trips`, () => {
      const { event, trips } = scrubStrings(eventWith({ messageHead: planted }));
      expect(event.fields.messageHead).toBe("charge failed for [scrubbed] today");
      expect(trips).toEqual([{ field: "messageHead" }]);
    });
  }

  const phoneShapes = [
    ["dashes", "call 555-123-4567 back"],
    ["dots", "call 555.123.4567 back"],
    ["spaces", "call 555 123 4567 back"],
    ["parenthesised area code", "call (555) 123-4567 back"],
    ["country code", "call +1 555-123-4567 back"],
  ] as const;

  for (const [label, planted] of phoneShapes) {
    it(`scrubs a phone number written with ${label} and trips`, () => {
      const { event, trips } = scrubStrings(eventWith({ messageHead: planted }));
      expect(event.fields.messageHead).toBe("call [scrubbed] back");
      expect(trips).toEqual([{ field: "messageHead" }]);
    });
  }

  it("still scrubs a run longer than any card, which the length-bounded pattern alone would miss", () => {
    // The separated-group pattern is bounded at 19 digits, so a longer unbroken run matches none of
    // its lengths; the plain digit-run pattern is what catches it. Both are needed.
    const { event, trips } = scrubStrings(eventWith({ messageHead: `acct ${"9".repeat(25)} x` }));
    expect(event.fields.messageHead).toBe("acct [scrubbed] x");
    expect(trips).toEqual([{ field: "messageHead" }]);
  });

  it("leaves the shapes ordinary telemetry is made of alone (no spurious trips)", () => {
    const benign = [
      "/api/v1/matters/:matterId/files/:fileId",
      "2026-06-13T00:00:00.000Z",
      "completed in 1234 ms",
      "HTTP 404 on attempt 3 of 5",
      "version 1.2.3-rc.4",
      "amount_minor 250000 USD",
    ];
    for (const value of benign) {
      expect(scrubText(value), value).toEqual({ text: value, tripped: false });
    }
  });
});

// The handle exemption must track the identifier generator, not a copy of its shape.
describe("scrubStrings — the handle exemption is derived from the identifier seam", () => {
  it("exempts a token of the generator's REAL length and alphabet, whatever it mints", () => {
    // A seeded-free real generator: whatever the seam currently produces must be recognised, so a
    // change to the token length or alphabet fails here instead of silently mangling Error IDs.
    const nextToken = makeTokenGenerator((bytes) =>
      Uint8Array.from({ length: bytes }, (_unused, index) => (index * 37) % 256),
    );
    for (let attempt = 0; attempt < 50; attempt++) {
      const handle = `error_${nextToken()}`;
      expect(scrubText(handle), handle).toEqual({ text: handle, tripped: false });
    }
  });

  it("does NOT exempt a body of the wrong length (a near-miss is content, not a handle)", () => {
    // One character longer than a real token: the same value with a TOKEN_SIZE body is exempt (the
    // dash-flanked-digit-run case above), so length is provably what decides it.
    const overlongBody = "aa-123456789-bbbbbbbbb";
    expect(overlongBody).toHaveLength(TOKEN_SIZE + 1);
    expect(scrubText(`error_${overlongBody}`).tripped).toBe(true);
    expect(scrubText(`error_${overlongBody.slice(1)}`).tripped).toBe(false);
  });
});

describe("scrubText — the editor surface's bearer token", () => {
  // The WOPI access token as the editor worker actually sees it: HS256, base64url, three segments.
  const TOKEN =
    "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJmaXh0dXJlIiwiZmlybUlkIjoiZmlybV9maXh0dXJlIiwiY2FwYWJpbGl0eSI6ImVkaXQifQ.fixture-signature-not-a-real-mac-0000000000";

  it("scrubs the token as the query parameter every editor request carries", () => {
    const { text, tripped } = scrubText(`permission=edit&access_token=${TOKEN}&compat=`);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("permission=edit");
    expect(tripped).toBe(true);
  });

  it("scrubs the bare token, which is how a message that unpacked the URL carries it", () => {
    const { text, tripped } = scrubText(`token ${TOKEN} was refused`);
    expect(text).toBe("token [scrubbed] was refused");
    expect(tripped).toBe(true);
  });

  it("scrubs a whole editor URL and leaves the route readable, which is the shape worth keeping", () => {
    const line = `WebSocket to wss://286b0ecd.magnacartausercontent.com/cool/ws?WOPISrc=http%3A%2F%2Fwopi.magna-carta.internal%2Fwopi%2Ffiles%2Ffile_abc&access_token=${TOKEN}&permission=edit failed`;
    const { text, tripped } = scrubText(line);
    expect(text).not.toContain(TOKEN);
    expect(text).toContain("/cool/ws");
    expect(text).toContain("permission=edit");
    expect(tripped).toBe(true);
  });

  it("leaves the shapes an editor log line is otherwise made of alone", () => {
    for (const value of [
      "/cool/ws",
      "/browser/dist/cool.html",
      "container answered 502 on /cool/ws",
      "UpgradeRefused",
      "editor.upgrade",
      "a.b.c", // three segments, nowhere near a token
      "eyJ.short.one", // opens like a token but is far too short to be one
    ]) {
      expect(scrubText(value)).toEqual({ text: value, tripped: false });
    }
  });
});
