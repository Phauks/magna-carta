import { describe, expect, it } from "vitest";
import {
  emptyIdentifierDraft,
  identifierDraftFields,
  identifierDraftRefusal,
  identifierNumberAsTyped,
  identifierRequestFrom,
  identifierRowFromDraft,
  identifierRowsFrom,
} from "../src/lib/directory/identifier-draft.ts";

describe("an identifier draft", () => {
  it("takes the fields its type declares, and formats a number as it is typed", () => {
    expect(identifierDraftFields("ssn").map((field) => field.key)).toEqual(["number"]);
    expect(identifierDraftFields("account").map((field) => field.key)).toEqual([
      "label",
      "number",
      "username",
      "secret",
    ]);
    expect(identifierNumberAsTyped("ssn", "12345")).toBe("123-45");
    expect(identifierNumberAsTyped("account", "CC-22")).toBe("CC-22");
  });

  it("is refused by the shared sentence until it fits, then becomes the request", () => {
    const short = { ...emptyIdentifierDraft("ssn"), number: "123-45-67" };
    expect(identifierDraftRefusal(short)).toBe("Nine digits, as 123-45-6789.");
    const account = {
      ...emptyIdentifierDraft("account"),
      label: "Cook County e-filing",
      number: "CC-2291-0087",
      username: " mokafor ",
      secret: "hunter2",
    };
    expect(identifierDraftRefusal(account)).toBeNull();
    expect(identifierRequestFrom(account)).toEqual({
      type: "account",
      label: "Cook County e-filing",
      number: "CC-2291-0087",
      username: "mokafor",
      secret: "hunter2",
    });
  });

  it("lists a record and a draft the same way: the type, what it is of, and bullets", () => {
    expect(
      identifierRowsFrom([
        {
          id: "one",
          type: "drivers_license",
          label: "Illinois",
          validFrom: null,
          validTo: null,
          recordedAt: "2026-09-03T00:00:00.000Z",
        },
      ]),
    ).toEqual([
      {
        id: "one",
        type: "drivers_license",
        typeLabel: "Driver's license",
        label: "Illinois",
        masked: "••••",
        recordedAt: "2026-09-03T00:00:00.000Z",
      },
    ]);
    expect(
      identifierRowFromDraft({ ...emptyIdentifierDraft("ssn"), number: "123-45-6789" }, "draft"),
    ).toMatchObject({
      typeLabel: "Social security number",
      label: null,
      masked: "•••-••-••••",
    });
  });
});
