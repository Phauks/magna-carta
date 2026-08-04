import { assert, expect, it } from "vitest";
import { classifyCoercion, coerceWithRule } from "../src/coercion.ts";

// The scale pair every classification states. WHOLE_UNITS is the plain-number case (both sides count
// whole units); the money cases name the exponent explicitly so the expected magnitude is readable.
const WHOLE_UNITS = { from: 0, to: 0 };
const WHOLE_UNITS_TO_CENTS = { from: 0, to: 2 };
const CENTS_TO_WHOLE_UNITS = { from: 2, to: 0 };

// ── classifyCoercion ──────────────────────────────────────────────────────────

it("text that is plain digits converts cleanly to a number", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "4250000" }, "single-line", "number", WHOLE_UNITS)
      .outcome,
  ).toBe("clean");
});

it("currency text with a magnitude suffix needs a rule", () => {
  expect(
    classifyCoercion(
      { kind: "single-line", text: "4.25M" },
      "single-line",
      "currency",
      WHOLE_UNITS_TO_CENTS,
    ).outcome,
  ).toBe("needs-rule");
});

it("free text with no number parks against a date", () => {
  expect(
    classifyCoercion(
      { kind: "single-line", text: "approx five" },
      "single-line",
      "date",
      WHOLE_UNITS,
    ).outcome,
  ).toBe("parked");
});

it("single-line to multi-line is always clean", () => {
  expect(
    classifyCoercion(
      { kind: "single-line", text: "anything" },
      "single-line",
      "multi-line",
      WHOLE_UNITS,
    ).outcome,
  ).toBe("clean");
});

it("picklist to text uses the option label and is clean", () => {
  expect(
    classifyCoercion(
      { kind: "picklist", optionLabel: "Filed" },
      "picklist",
      "single-line",
      WHOLE_UNITS,
    ).outcome,
  ).toBe("clean");
});

// ── additional boundary cases ─────────────────────────────────────────────────

it("same kind is always a clean trivial coercion", () => {
  const result = classifyCoercion({ kind: "number", number: 42 }, "number", "number", WHOLE_UNITS);
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 42 });
});

it("number → currency re-expresses whole units as minor units", () => {
  const result = classifyCoercion(
    { kind: "number", number: 100 },
    "number",
    "currency",
    WHOLE_UNITS_TO_CENTS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 10_000 });
});

it("currency → number divides the minor units back out when the division is exact", () => {
  const result = classifyCoercion(
    { kind: "currency", number: 9900 },
    "currency",
    "number",
    CENTS_TO_WHOLE_UNITS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 99 });
});

it("currency → number parks a value with cents a whole-unit column cannot hold", () => {
  expect(
    classifyCoercion({ kind: "currency", number: 9950 }, "currency", "number", CENTS_TO_WHOLE_UNITS)
      .outcome,
  ).toBe("parked");
});

it("currency → text renders the stored minor units as the decimal a person wrote", () => {
  const result = classifyCoercion({ kind: "currency", number: 50_000 }, "currency", "single-line", {
    from: 2,
    to: 0,
  });
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_text", text: "500.00" });
});

it("text → currency reads the decimal at the target's scale", () => {
  const result = classifyCoercion(
    { kind: "single-line", text: "500.00" },
    "single-line",
    "currency",
    WHOLE_UNITS_TO_CENTS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 50_000 });
});

it("text → number parks a decimal a whole-unit column cannot hold exactly", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "12.34" }, "single-line", "number", WHOLE_UNITS)
      .outcome,
  ).toBe("parked");
});

it("checkbox → currency re-expresses the flag at the money scale", () => {
  const result = classifyCoercion(
    { kind: "checkbox", checkbox: 1 },
    "checkbox",
    "currency",
    WHOLE_UNITS_TO_CENTS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 100 });
});

it("text → number strips commas before checking", () => {
  const result = classifyCoercion(
    { kind: "single-line", text: "1,000" },
    "single-line",
    "number",
    WHOLE_UNITS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 1000 });
});

it("text → number strips leading dollar sign", () => {
  const result = classifyCoercion(
    { kind: "single-line", text: "$500" },
    "single-line",
    "number",
    WHOLE_UNITS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 500 });
});

it("magnitude suffix k needs-rule against number", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "10k" }, "single-line", "number", WHOLE_UNITS)
      .outcome,
  ).toBe("needs-rule");
});

it("magnitude suffix B (billions) needs-rule against currency", () => {
  expect(
    classifyCoercion(
      { kind: "single-line", text: "1.5B" },
      "single-line",
      "currency",
      WHOLE_UNITS_TO_CENTS,
    ).outcome,
  ).toBe("needs-rule");
});

it("free text parks against number", () => {
  expect(
    classifyCoercion(
      { kind: "single-line", text: "not a number" },
      "single-line",
      "number",
      WHOLE_UNITS,
    ).outcome,
  ).toBe("parked");
});

it("any value → picklist needs-rule", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "Open" }, "single-line", "picklist", WHOLE_UNITS)
      .outcome,
  ).toBe("needs-rule");
});

it("ISO date text → date is clean", () => {
  const result = classifyCoercion(
    { kind: "single-line", text: "2025-01-15" },
    "single-line",
    "date",
    WHOLE_UNITS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_date", date: "2025-01-15" });
});

it("ISO datetime text → date is clean (prefix match)", () => {
  expect(
    classifyCoercion(
      { kind: "single-line", text: "2025-01-15T14:30:00Z" },
      "single-line",
      "date",
      WHOLE_UNITS,
    ).outcome,
  ).toBe("clean");
});

it("ambiguous date text parks", () => {
  expect(
    classifyCoercion(
      { kind: "single-line", text: "Jan 15, 2025" },
      "single-line",
      "date",
      WHOLE_UNITS,
    ).outcome,
  ).toBe("parked");
});

it("picklist → text yields the option label", () => {
  const result = classifyCoercion(
    { kind: "picklist", optionLabel: "Closed" },
    "picklist",
    "single-line",
    WHOLE_UNITS,
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_text", text: "Closed" });
});

it("url to email (both text family) is clean", () => {
  expect(
    classifyCoercion({ kind: "url", text: "https://example.com" }, "url", "email", WHOLE_UNITS)
      .outcome,
  ).toBe("clean");
});

it("number to url (text family) is clean and stringifies", () => {
  const result = classifyCoercion({ kind: "number", number: 7 }, "number", "url", WHOLE_UNITS);
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_text", text: "7" });
});

// ── coerceWithRule ────────────────────────────────────────────────────────────

it("coerceWithRule multiplies by 1 000 for k suffix", () => {
  const result = coerceWithRule(
    { kind: "single-line", text: "10k" },
    "number",
    {
      kind: "magnitude",
    },
    0,
  );
  expect(result).toEqual({ column: "value_number", number: 10_000 });
});

it("coerceWithRule expresses an M suffix at the target currency scale", () => {
  const result = coerceWithRule(
    { kind: "single-line", text: "4.25M" },
    "currency",
    {
      kind: "magnitude",
    },
    2,
  );
  expect(result).toEqual({ column: "value_number", number: 425_000_000 });
});

it("coerceWithRule multiplies by 1 000 000 000 for B suffix", () => {
  const result = coerceWithRule(
    { kind: "single-line", text: "2B" },
    "number",
    {
      kind: "magnitude",
    },
    0,
  );
  expect(result).toEqual({ column: "value_number", number: 2_000_000_000 });
});

it("coerceWithRule refuses a magnitude that is not a whole number at the target scale", () => {
  expect(() =>
    coerceWithRule({ kind: "single-line", text: "1.2345k" }, "number", { kind: "magnitude" }, 0),
  ).toThrow("exact integer");
});

it("coerceWithRule for → picklist returns the new option to create", () => {
  const result = coerceWithRule(
    { kind: "single-line", text: "Open" },
    "picklist",
    {
      kind: "create-option",
      label: "Open",
    },
    0,
  );
  expect(result).toEqual({ action: "create-option", label: "Open" });
});

it("coerceWithRule handles uppercase K suffix", () => {
  const result = coerceWithRule(
    { kind: "single-line", text: "5K" },
    "number",
    {
      kind: "magnitude",
    },
    0,
  );
  expect(result).toEqual({ column: "value_number", number: 5_000 });
});

it("coerceWithRule handles lowercase m suffix", () => {
  const result = coerceWithRule(
    { kind: "single-line", text: "3m" },
    "currency",
    {
      kind: "magnitude",
    },
    2,
  );
  expect(result).toEqual({ column: "value_number", number: 300_000_000 });
});
