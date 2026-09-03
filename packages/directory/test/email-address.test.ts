import { expect, test } from "vitest";
import { isEmailAddress } from "../src/email-address.ts";

test("an address is a mailbox, one @, and a domain with a dot", () => {
  for (const good of [
    "m.okafor@example.com",
    "  M.Okafor@Example.COM ",
    "first+tag@sub.firm.co.uk",
    "o'brien@firm.ie",
  ]) {
    expect(isEmailAddress(good), good).toBe(true);
  }
  for (const bad of [
    "",
    "m.okafor",
    "m.okafor@",
    "@example.com",
    "m.okafor@example",
    "m okafor@example.com",
    "m.okafor@@example.com",
    "m..okafor@example.com",
    "m.okafor@-example.com",
    "m.okafor@example.123",
  ]) {
    expect(isEmailAddress(bad), bad).toBe(false);
  }
});
