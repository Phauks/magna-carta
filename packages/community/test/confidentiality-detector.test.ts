import { describe, expect, it } from "vitest";
import { detectConfidentialDetail } from "../src/confidentiality-detector.ts";

const kinds = (text: string) =>
  detectConfidentialDetail(text).map((finding) => [finding.kind, finding.text]);

describe("detectConfidentialDetail", () => {
  it("finds a case caption and a matter number, each once", () => {
    expect(
      kinds(
        "When we reverse a payment for Hendricks v. Lowell, matter 2026-CV-0412, the invoice reopens.",
      ),
    ).toEqual([
      ["case-caption", "Hendricks v. Lowell"],
      ["docket-or-matter-number", "matter 2026-CV-0412"],
    ]);
  });

  it("finds federal docket shapes and labelled numbers", () => {
    expect(kinds("Filed under 1:24-cv-01234 last week")).toEqual([
      ["docket-or-matter-number", "1:24-cv-01234"],
    ]);
    expect(kinds("see case no. 18-445 for the rest")).toEqual([
      ["docket-or-matter-number", "case no. 18-445"],
    ]);
  });

  it("finds In re captions, email addresses and phone numbers", () => {
    expect(kinds("In re Estate of Marsh is stuck")).toEqual([
      ["case-caption", "In re Estate of Marsh"],
    ]);
    expect(kinds("email dana@example.com")).toEqual([["email-address", "dana@example.com"]]);
    expect(kinds("call (702) 555-0142 tomorrow")).toEqual([["phone-number", "(702) 555-0142"]]);
  });

  it("finds an amount only when a name stands near it", () => {
    expect(kinds("A retainer of $12,500.00 from Maria Lopez arrived in two parts")).toEqual([
      ["money-beside-a-name", "$12,500.00"],
    ]);
    expect(kinds("A retainer of $12,500.00 arrived in two parts")).toEqual([]);
    expect(kinds("Is Magna Carta $20 a seat?")).toEqual([]);
  });

  it("passes an ordinary product question untouched", () => {
    expect(
      kinds("How do I bulk-edit custom fields across twenty matters from the matter list?"),
    ).toEqual([]);
    expect(kinds("Split one invoice across two trust accounts")).toEqual([]);
  });
});
