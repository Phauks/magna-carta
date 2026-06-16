import { describe, expect, it } from "vitest";
import { integrationProblem } from "../src/problem.ts";

describe("integrationProblem", () => {
  it("marks transient categories retryable and terminal ones not", () => {
    expect(integrationProblem("rate_limit", 429, "Throttled").retryable).toBe(true);
    expect(integrationProblem("network", 502, "Network error").retryable).toBe(true);
    expect(integrationProblem("upstream", 503, "Upstream down").retryable).toBe(true);
    expect(integrationProblem("auth", 401, "Reauthorize").retryable).toBe(false);
    expect(integrationProblem("validation", 422, "Bad shape").retryable).toBe(false);
  });

  it("derives a category-scoped type URI and carries optional members", () => {
    const problem = integrationProblem("auth", 401, "Reauthorize", {
      detail: "token expired",
      correlationId: "correlation_abc",
    });
    expect(problem.type).toBe("https://magnacarta.esq/problems/integration/auth");
    expect(problem.detail).toBe("token expired");
    expect(problem.correlationId).toBe("correlation_abc");
    expect(problem.status).toBe(401);
  });
});
