import { describe, expect, test } from "vitest";
import {
  accountNumberOf,
  checkIdentifier,
  formatEmployerIdentificationNumber,
  formatIdentifierEntry,
  formatSocialSecurityNumber,
  identifierShapesFor,
  maskedIdentifier,
  parseAccountValue,
} from "../src/identifier-shape.ts";

describe("the type decides the fields", () => {
  test("a person is offered the person kinds and an organization the organization kinds", () => {
    expect(identifierShapesFor("person").map((shape) => shape.type)).toEqual([
      "ssn",
      "ssn_last_four",
      "drivers_license",
      "bar_number",
      "account",
    ]);
    expect(identifierShapesFor("organization").map((shape) => shape.type)).toEqual([
      "ein",
      "account",
    ]);
  });

  test("an account is who it is held with, a number, and the username and secret that belong to it", () => {
    const account = identifierShapesFor("person").find((shape) => shape.type === "account");
    expect(
      account?.fields.map((field) => `${field.key}:${field.required ? "required" : "optional"}`),
    ).toEqual(["label:required", "number:required", "username:optional", "secret:optional"]);
  });
});

describe("a social security number", () => {
  test("formats as it is typed, nine digits in three groups", () => {
    expect(formatSocialSecurityNumber("1")).toBe("1");
    expect(formatSocialSecurityNumber("1234")).toBe("123-4");
    expect(formatSocialSecurityNumber("123456")).toBe("123-45-6");
    expect(formatSocialSecurityNumber("123456789")).toBe("123-45-6789");
    expect(formatSocialSecurityNumber("123-45-67890")).toBe("123-45-6789");
    expect(formatIdentifierEntry("ssn", "12a3")).toBe("123");
  });

  test("is refused short and refused long, and sealed with its dashes", () => {
    expect(checkIdentifier("ssn", { number: "123-45-67" })).toEqual({
      ok: false,
      reason: "Nine digits, as 123-45-6789.",
    });
    expect(checkIdentifier("ssn", { number: "1234567890" })).toMatchObject({ ok: false });
    expect(checkIdentifier("ssn", { number: "123456789" })).toEqual({
      ok: true,
      value: "123-45-6789",
      label: null,
    });
  });
});

describe("the other numbered kinds", () => {
  test("an employer identification number is nine digits in two groups", () => {
    expect(formatEmployerIdentificationNumber("123456789")).toBe("12-3456789");
    expect(checkIdentifier("ein", { number: "12-345678" })).toMatchObject({ ok: false });
    expect(checkIdentifier("ein", { number: "12 3456789" })).toEqual({
      ok: true,
      value: "12-3456789",
      label: null,
    });
  });

  test("the last four are four digits and nothing else", () => {
    expect(checkIdentifier("ssn_last_four", { number: "678" })).toMatchObject({ ok: false });
    expect(checkIdentifier("ssn_last_four", { number: "6789" })).toMatchObject({
      ok: true,
      value: "6789",
    });
  });
});

describe("a licence and a bar number carry what issued them", () => {
  test("a licence needs the issuing region and is sealed region-qualified", () => {
    expect(checkIdentifier("drivers_license", { number: "O5304471" })).toEqual({
      ok: false,
      reason: "The state or country that issued it.",
    });
    expect(checkIdentifier("drivers_license", { label: "IL", number: "" })).toMatchObject({
      ok: false,
    });
    expect(checkIdentifier("drivers_license", { label: "il", number: "o530-4471" })).toEqual({
      ok: true,
      value: "IL:O530-4471",
      label: "il",
    });
  });

  test("a bar number needs its jurisdiction, which is its label", () => {
    expect(checkIdentifier("bar_number", { number: "6301234" })).toMatchObject({ ok: false });
    expect(checkIdentifier("bar_number", { label: "Illinois", number: "6301234" })).toEqual({
      ok: true,
      value: "6301234",
      label: "Illinois",
    });
  });
});

describe("an account", () => {
  test("is refused as a bare number", () => {
    expect(checkIdentifier("account", { number: "CC-2291-0087" })).toEqual({
      ok: false,
      reason: "Who the account is held with.",
    });
  });

  test("seals its parts together and reads them back; a bare value sealed before pairing still reads", () => {
    const checked = checkIdentifier("account", {
      label: "Cook County e-filing",
      number: "CC-2291-0087",
      username: " mokafor ",
      secret: "hunter2",
    });
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.label).toBe("Cook County e-filing");
    expect(parseAccountValue(checked.value)).toEqual({
      number: "CC-2291-0087",
      username: "mokafor",
      secret: "hunter2",
    });
    expect(accountNumberOf(checked.value)).toBe("CC-2291-0087");
    expect(parseAccountValue("ACCT-1")).toEqual({ number: "ACCT-1", username: null, secret: null });
  });
});

test("a list shows bullets and nothing of the value", () => {
  expect(maskedIdentifier("ssn", null)).toBe("•••-••-••••");
  expect(maskedIdentifier("ein", null)).toBe("••-•••••••");
  expect(maskedIdentifier("account", null)).toBe("••••");
});
