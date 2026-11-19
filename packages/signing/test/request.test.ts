import { describe, expect, it } from "vitest";

import {
  completionCounts,
  decline,
  draftProblems,
  fieldsInReadingOrder,
  hasExpired,
  nextField,
  open,
  send,
  sign,
  voidRequest,
  type RequestSigner,
  type SigningField,
  type SigningRequestState,
  type Transition,
} from "../src/request.ts";

const signer = (
  id: string,
  position: number,
  extra: Partial<RequestSigner> = {},
): RequestSigner => ({
  id,
  position,
  name: `Signer ${id}`,
  email: `${id}@example.com`,
  attribution: "email-link",
  status: "waiting",
  ...extra,
});

const field = (
  id: string,
  signerId: string,
  kind: SigningField["kind"],
  page = 1,
  top = 200,
  left = 72,
): SigningField => ({
  id,
  signerId,
  kind,
  page,
  rect: [left, top - 30, left + 180, top],
  required: true,
});

const draft = (order: SigningRequestState["order"] = "in-order"): SigningRequestState => ({
  status: "draft",
  order,
  signers: [signer("a", 1), signer("b", 2)],
  fields: [
    field("f1", "a", "signature"),
    field("f2", "b", "signature"),
    field("f3", "a", "initials"),
  ],
  expiresAt: "2026-12-13T00:00:00Z",
});

function after(transition: Transition): SigningRequestState {
  if (!transition.ok) throw new Error(transition.reason);
  return transition.request;
}

const statuses = (request: SigningRequestState) => request.signers.map((one) => one.status);

describe("a draft", () => {
  it("can be sent when every signer has a signature field and a way to be reached", () => {
    expect(draftProblems(draft(), 6)).toEqual([]);
  });

  it("names what is missing", () => {
    const request: SigningRequestState = {
      ...draft(),
      signers: [
        signer("a", 1, { email: "not an address" }),
        signer("b", 2, { attribution: "firm-authenticated" }),
        signer("c", 3, { attribution: "id-verified" }),
      ],
      fields: [field("f1", "a", "signature", 9), field("f2", "b", "initials")],
    };
    expect(draftProblems(request, 6)).toEqual([
      "Signer a needs an email address the request can be sent to.",
      "Choose which firm member Signer b is.",
      "Place at least one signature field for Signer b.",
      "Signer c has a way of proving identity that is not offered yet.",
      "Place at least one signature field for Signer c.",
      "A field is on page 9, and this document has 6.",
    ]);
  });

  it("refuses a field too small to sign in", () => {
    const request = {
      ...draft(),
      fields: [...draft().fields, { ...field("f4", "a", "text"), rect: [0, 0, 4, 4] as const }],
    };
    expect(draftProblems(request, 6)).toEqual(["A field on page 1 is too small to sign in."]);
  });
});

describe("in order", () => {
  it("asks the first signer, then the next when the first signs, then completes", () => {
    const sent = after(send(draft(), 6));
    expect(sent.status).toBe("sent");
    expect(statuses(sent)).toEqual(["notified", "waiting"]);

    const opened = after(open(sent, "a"));
    expect(statuses(opened)).toEqual(["opened", "waiting"]);

    const firstSigned = sign(opened, "a");
    expect(firstSigned.ok && firstSigned.notify.map((one) => one.id)).toEqual(["b"]);
    const second = after(firstSigned);
    expect(statuses(second)).toEqual(["signed", "notified"]);

    const done = after(sign(second, "b"));
    expect(done.status).toBe("completed");
  });

  it("refuses a signer whose turn has not come", () => {
    const sent = after(send(draft(), 6));
    expect(open(sent, "b")).toEqual({
      ok: false,
      reason: "It is not your turn to sign yet. You will get an email when it is.",
    });
    expect(sign(sent, "b")).toEqual({ ok: false, reason: "It is not your turn to sign yet." });
  });

  it("refuses signing twice", () => {
    const signed = after(sign(after(send(draft(), 6)), "a"));
    expect(sign(signed, "a")).toEqual({ ok: false, reason: "You have already signed." });
  });
});

describe("all at once", () => {
  it("asks everyone on send", () => {
    const sent = send(draft("all-at-once"), 6);
    expect(sent.ok && sent.notify.map((one) => one.id)).toEqual(["a", "b"]);
  });
});

describe("ending early", () => {
  it("ends the request when a signer declines", () => {
    const declined = after(decline(after(send(draft(), 6)), "a"));
    expect(declined.status).toBe("declined");
    expect(sign(declined, "a")).toEqual({
      ok: false,
      reason: "This request was declined, so it can no longer be signed.",
    });
  });

  it("can be cancelled while out for signing, but not once complete", () => {
    expect(after(voidRequest(after(send(draft(), 6)))).status).toBe("voided");
    const completed: SigningRequestState = { ...draft(), status: "completed" };
    expect(voidRequest(completed).ok).toBe(false);
  });

  it("expires only while out for signing", () => {
    const sent = after(send(draft(), 6));
    expect(hasExpired(sent, new Date("2026-12-12T23:59:59Z"))).toBe(false);
    expect(hasExpired(sent, new Date("2026-12-13T00:00:00Z"))).toBe(true);
    expect(hasExpired(draft(), new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("a signer's fields", () => {
  const fields = [
    field("low", "a", "signature", 1, 100),
    field("high-right", "a", "date-signed", 1, 300, 300),
    field("high-left", "a", "initials", 1, 300, 72),
    field("next-page", "a", "text", 2, 700),
    field("other", "b", "signature", 1, 400),
  ];

  it("are met by page, then down the page, then across", () => {
    expect(fieldsInReadingOrder(fields, "a").map((one) => one.id)).toEqual([
      "high-left",
      "high-right",
      "low",
      "next-page",
    ]);
  });

  it("skip what fills itself and what is done", () => {
    expect(nextField(fields, "a", {})?.id).toBe("high-left");
    expect(nextField(fields, "a", { "high-left": true })?.id).toBe("low");
    expect(nextField(fields, "a", { "high-left": true, low: true, "next-page": "  " })?.id).toBe(
      "next-page",
    );
    expect(
      nextField(fields, "a", { "high-left": true, low: true, "next-page": "Ellison" }),
    ).toBeNull();
  });

  it("are counted for the certificate", () => {
    expect(completionCounts(fields, "a")).toEqual({ signatureCount: 1, initialCount: 1 });
  });
});
