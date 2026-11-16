// The walk through an outside signer's own fields: what counts as done, what comes next, what is sent.
import { describe, expect, it } from "vitest";
import {
  answersToSend,
  finishRefusal,
  initialsFrom,
  nextFieldToDo,
  progressOf,
  type SignerField,
} from "../src/lib/signing/signer-walk.ts";

function field(id: string, kind: SignerField["kind"], required = true): SignerField {
  return { id, kind, page: 1, rect: [0, 0, 10, 10], required };
}

const fields: SignerField[] = [
  field("sign", "signature"),
  field("date", "date-signed"),
  field("company", "text"),
  field("agree", "checkbox", false),
  field("initial", "initials"),
];

describe("a signer's walk", () => {
  it("counts the fields the signer acts on, and an optional one only once it is done", () => {
    expect(progressOf(fields, {}, false)).toEqual({ done: 0, total: 3 });
    expect(progressOf(fields, { company: "Acme" }, true)).toEqual({ done: 3, total: 3 });
    expect(progressOf(fields, { company: "Acme", agree: true }, true)).toEqual({
      done: 4,
      total: 4,
    });
  });

  it("goes to the next required field still to do, wrapping round to the first", () => {
    expect(nextFieldToDo(fields, {}, false, null)?.id).toBe("sign");
    expect(nextFieldToDo(fields, {}, false, "sign")?.id).toBe("company");
    expect(nextFieldToDo(fields, {}, false, "initial")?.id).toBe("sign");
    expect(nextFieldToDo(fields, { company: " " }, true, null)?.id).toBe("company");
    expect(nextFieldToDo(fields, { company: "Acme" }, true, null)).toBeNull();
  });

  it("refuses Finish until the mark is adopted and every required field is filled", () => {
    expect(finishRefusal(fields, {}, false)).toBe("Adopt your signature first.");
    expect(finishRefusal(fields, {}, true)).toBe("One required field is still empty.");
    expect(finishRefusal(fields, { company: "Acme" }, true)).toBeNull();
  });

  it("sends only text and checkbox answers, trimmed", () => {
    expect(answersToSend(fields, { company: "  Acme  ", sign: "x", agree: false })).toEqual({
      company: "Acme",
      agree: false,
    });
  });

  it("makes initials from a name", () => {
    expect(initialsFrom("Jordan  Smith")).toBe("JS");
    expect(initialsFrom("  ")).toBe("");
  });
});
