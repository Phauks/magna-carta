import { expect, test } from "vitest";
import { decidePlatformOperatorAccess } from "../src/platform-operator.ts";

test("no row => not an operator", () => {
  expect(decidePlatformOperatorAccess(undefined)).toEqual({ allow: false, reason: "not-operator" });
});

test("operator without 2FA => mfa-required", () => {
  expect(decidePlatformOperatorAccess({ user_id: "usr_1", two_factor_enabled: 0 })).toEqual({
    allow: false,
    reason: "mfa-required",
  });
});

test("operator with 2FA => allow", () => {
  expect(decidePlatformOperatorAccess({ user_id: "usr_1", two_factor_enabled: 1 })).toEqual({
    allow: true,
  });
});
