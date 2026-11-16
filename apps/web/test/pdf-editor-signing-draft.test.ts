import { describe, expect, it } from "vitest";
import type { SigningRequestDetail } from "../src/lib/pdf-editor/signing-api.ts";
import {
  dayAfter,
  draftFromDetail,
  draftRequest,
  endOfDay,
  fieldAt,
  fieldCounts,
  initialsOf,
  moveSigner,
  withoutSigner,
  type SigningDraft,
} from "../src/lib/pdf-editor/signing-draft.ts";

const LETTER = { widthPt: 612, heightPt: 792 };

function draft(): SigningDraft {
  return {
    subject: "  ",
    message: "",
    order: "in-order",
    expiresOn: "2026-12-13",
    remindEveryDays: 3,
    signers: [
      { key: "a", name: "Jordan Smith", email: "jordan@example.com", attribution: "access-code" },
      {
        key: "b",
        name: "Riley Park",
        email: "left-over@example.com",
        attribution: "firm-authenticated",
        userId: "user_1",
      },
    ],
    fields: [
      {
        key: "f1",
        signerKey: "a",
        kind: "signature",
        page: 1,
        rect: [10, 10, 190, 46],
        required: true,
      },
      {
        key: "f2",
        signerKey: "a",
        kind: "date-signed",
        page: 1,
        rect: [200, 10, 310, 30],
        required: true,
      },
      {
        key: "f3",
        signerKey: "b",
        kind: "signature",
        page: 2,
        rect: [10, 10, 190, 46],
        required: true,
      },
    ],
  };
}

describe("a signing draft", () => {
  it("drops a field centred on the click, at its kind's size, inside the page", () => {
    expect(fieldAt("signature", { x: 306, y: 396 }, LETTER)).toEqual([216, 378, 396, 414]);
    expect(fieldAt("signature", { x: 0, y: 0 }, LETTER)).toEqual([0, 0, 180, 36]);
    expect(fieldAt("checkbox", { x: 612, y: 792 }, LETTER)).toEqual([598, 778, 612, 792]);
  });

  it("reads initials from the first and last names", () => {
    expect(initialsOf("Jordan Smith")).toBe("JS");
    expect(initialsOf("  jordan  q  smith ")).toBe("JS");
    expect(initialsOf("Cher")).toBe("C");
    expect(initialsOf("   ")).toBe("?");
  });

  it("counts fields per signer, and removes a signer with every field they held", () => {
    expect(fieldCounts(draft())).toEqual(
      new Map([
        ["a", 2],
        ["b", 1],
      ]),
    );
    const without = withoutSigner(draft(), "a");
    expect(without.signers.map((signer) => signer.key)).toEqual(["b"]);
    expect(without.fields.map((field) => field.key)).toEqual(["f3"]);
  });

  it("moves a signer within the order and never off its ends", () => {
    expect(moveSigner(draft(), "a", 1).signers.map((signer) => signer.key)).toEqual(["b", "a"]);
    expect(moveSigner(draft(), "a", -1).signers.map((signer) => signer.key)).toEqual(["a", "b"]);
  });

  it("counts days in the member's own calendar and ends the last one at its last second", () => {
    expect(dayAfter(30, new Date(2026, 10, 13, 9))).toBe("2026-12-13");
    const end = new Date(endOfDay("2026-12-13"));
    expect([
      end.getFullYear(),
      end.getMonth(),
      end.getDate(),
      end.getHours(),
      end.getMinutes(),
    ]).toEqual([2026, 11, 13, 23, 59]);
  });

  it("sends a firm member with no address and gives a blank subject a default", () => {
    const request = draftRequest(draft());
    expect(request.subject).toBe("Please sign");
    expect(request.signers[1]).toEqual({
      key: "b",
      name: "Riley Park",
      email: "",
      attribution: "firm-authenticated",
      userId: "user_1",
    });
    expect(request.fields[0]).toEqual({
      signerKey: "a",
      kind: "signature",
      page: 1,
      rect: [10, 10, 190, 46],
      required: true,
    });
  });

  it("reads a stored request back as the draft it was saved from", () => {
    const detail = {
      subject: "Please sign",
      message: "Thanks",
      order: "all-at-once",
      expiresAt: endOfDay("2026-12-13"),
      remindEveryDays: null,
      signers: [
        {
          id: "sgn_1",
          position: 1,
          name: "Jordan Smith",
          email: "jordan@example.com",
          attribution: "email-link",
          userId: null,
        },
      ],
      fields: [
        {
          id: "fld_1",
          signerId: "sgn_1",
          kind: "initials",
          page: 3,
          rect: [1, 2, 61, 32],
          required: false,
        },
      ],
    } as unknown as SigningRequestDetail;
    const read = draftFromDetail(detail);
    expect(read.expiresOn).toBe("2026-12-13");
    expect(read.signers).toEqual([
      {
        key: "sgn_1",
        name: "Jordan Smith",
        email: "jordan@example.com",
        attribution: "email-link",
      },
    ]);
    expect(read.fields).toEqual([
      {
        key: "fld_1",
        signerKey: "sgn_1",
        kind: "initials",
        page: 3,
        rect: [1, 2, 61, 32],
        required: false,
      },
    ]);
  });
});
