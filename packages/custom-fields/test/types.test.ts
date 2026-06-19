import { expect, it } from "vitest";
import { CUSTOM_FIELD_KINDS, isCustomFieldKind, CustomFieldError } from "../src/types.ts";

it("lists exactly the twelve kinds", () => {
  expect(CUSTOM_FIELD_KINDS).toHaveLength(12);
  expect(isCustomFieldKind("currency")).toBe(true);
  expect(isCustomFieldKind("rating")).toBe(false);
});

it("CustomFieldError carries a stable code", () => {
  const error = new CustomFieldError("field-in-use", "still has values");
  expect(error.code).toBe("field-in-use");
  expect(error).toBeInstanceOf(Error);
});
