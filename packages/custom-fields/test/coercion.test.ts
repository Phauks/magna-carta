import { assert, expect, it } from "vitest";
import { classifyCoercion, coerceWithRule } from "../src/coercion.ts";

// ── classifyCoercion ──────────────────────────────────────────────────────────

it("text that is plain digits converts cleanly to a number", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "4250000" }, "single-line", "number").outcome,
  ).toBe("clean");
});

it("currency text with a magnitude suffix needs a rule", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "4.25M" }, "single-line", "currency").outcome,
  ).toBe("needs-rule");
});

it("free text with no number parks against a date", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "approx five" }, "single-line", "date").outcome,
  ).toBe("parked");
});

it("single-line to multi-line is always clean", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "anything" }, "single-line", "multi-line")
      .outcome,
  ).toBe("clean");
});

it("picklist to text uses the option label and is clean", () => {
  expect(
    classifyCoercion({ kind: "picklist", optionLabel: "Filed" }, "picklist", "single-line").outcome,
  ).toBe("clean");
});

// ── additional boundary cases ─────────────────────────────────────────────────

it("same kind is always a clean trivial coercion", () => {
  const result = classifyCoercion({ kind: "number", number: 42 }, "number", "number");
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 42 });
});

it("number → currency is clean (re-scale handled at apply time)", () => {
  const result = classifyCoercion({ kind: "number", number: 100 }, "number", "currency");
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 100 });
});

it("currency → number is clean", () => {
  expect(classifyCoercion({ kind: "currency", number: 9900 }, "currency", "number").outcome).toBe(
    "clean",
  );
});

it("text → number strips commas before checking", () => {
  const result = classifyCoercion({ kind: "single-line", text: "1,000" }, "single-line", "number");
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 1000 });
});

it("text → number strips leading dollar sign", () => {
  const result = classifyCoercion({ kind: "single-line", text: "$500" }, "single-line", "number");
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_number", number: 500 });
});

it("magnitude suffix k needs-rule against number", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "10k" }, "single-line", "number").outcome,
  ).toBe("needs-rule");
});

it("magnitude suffix B (billions) needs-rule against currency", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "1.5B" }, "single-line", "currency").outcome,
  ).toBe("needs-rule");
});

it("free text parks against number", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "not a number" }, "single-line", "number")
      .outcome,
  ).toBe("parked");
});

it("any value → picklist needs-rule", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "Open" }, "single-line", "picklist").outcome,
  ).toBe("needs-rule");
});

it("ISO date text → date is clean", () => {
  const result = classifyCoercion(
    { kind: "single-line", text: "2025-01-15" },
    "single-line",
    "date",
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_date", date: "2025-01-15" });
});

it("ISO datetime text → date is clean (prefix match)", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "2025-01-15T14:30:00Z" }, "single-line", "date")
      .outcome,
  ).toBe("clean");
});

it("ambiguous date text parks", () => {
  expect(
    classifyCoercion({ kind: "single-line", text: "Jan 15, 2025" }, "single-line", "date").outcome,
  ).toBe("parked");
});

it("picklist → text yields the option label", () => {
  const result = classifyCoercion(
    { kind: "picklist", optionLabel: "Closed" },
    "picklist",
    "single-line",
  );
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_text", text: "Closed" });
});

it("url to email (both text family) is clean", () => {
  expect(
    classifyCoercion({ kind: "url", text: "https://example.com" }, "url", "email").outcome,
  ).toBe("clean");
});

it("number to url (text family) is clean and stringifies", () => {
  const result = classifyCoercion({ kind: "number", number: 7 }, "number", "url");
  expect(result.outcome).toBe("clean");
  assert(result.outcome === "clean");
  expect(result.coerced).toEqual({ column: "value_text", text: "7" });
});

// ── coerceWithRule ────────────────────────────────────────────────────────────

it("coerceWithRule multiplies by 1 000 for k suffix", () => {
  const result = coerceWithRule({ kind: "single-line", text: "10k" }, "number", {
    kind: "magnitude",
  });
  expect(result).toEqual({ column: "value_number", number: 10_000 });
});

it("coerceWithRule multiplies by 1 000 000 for M suffix", () => {
  const result = coerceWithRule({ kind: "single-line", text: "4.25M" }, "currency", {
    kind: "magnitude",
  });
  expect(result).toEqual({ column: "value_number", number: 4_250_000 });
});

it("coerceWithRule multiplies by 1 000 000 000 for B suffix", () => {
  const result = coerceWithRule({ kind: "single-line", text: "2B" }, "number", {
    kind: "magnitude",
  });
  expect(result).toEqual({ column: "value_number", number: 2_000_000_000 });
});

it("coerceWithRule for → picklist returns the new option to create", () => {
  const result = coerceWithRule({ kind: "single-line", text: "Open" }, "picklist", {
    kind: "create-option",
    label: "Open",
  });
  expect(result).toEqual({ action: "create-option", label: "Open" });
});

it("coerceWithRule handles uppercase K suffix", () => {
  const result = coerceWithRule({ kind: "single-line", text: "5K" }, "number", {
    kind: "magnitude",
  });
  expect(result).toEqual({ column: "value_number", number: 5_000 });
});

it("coerceWithRule handles lowercase m suffix", () => {
  const result = coerceWithRule({ kind: "single-line", text: "3m" }, "currency", {
    kind: "magnitude",
  });
  expect(result).toEqual({ column: "value_number", number: 3_000_000 });
});
