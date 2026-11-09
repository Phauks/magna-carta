import { describe, expect, it } from "vitest";
import type { FirmId } from "@magna-carta/identifiers/types";
import {
  assertZdrEligible,
  deriveFirmMetadata,
  GATEWAY_ID,
  gatewayOptions,
  type GatewayOptions,
  zdrRejection,
} from "../src/gateway.ts";

const FIRM = "firm_abc" as FirmId;

describe("GATEWAY_ID", () => {
  it("is a stable non-empty string constant", () => {
    expect(typeof GATEWAY_ID).toBe("string");
    expect(GATEWAY_ID.length).toBeGreaterThan(0);
  });

  it("is pinned to the exact Cloudflare AI Gateway routing identifier", () => {
    expect(GATEWAY_ID).toBe("magna-carta-inference");
  });
});

describe("GatewayOptions shape", () => {
  it("pins skipCache:true and collectLog:false on every request", () => {
    const options: GatewayOptions = gatewayOptions(FIRM, "reasoning", "production");
    // Runtime: verify the values are the required literals.
    expect(options.skipCache).toBe(true);
    expect(options.collectLog).toBe(false);
  });

  it("carries an id and metadata field", () => {
    const options = gatewayOptions(FIRM, "reasoning", "production");
    expect(typeof options.id).toBe("string");
    expect(typeof options.metadata).toBe("object");
  });
});

describe("deriveFirmMetadata", () => {
  it("carries derived firm_id, slot, env — opaque ids only", () => {
    const metadata = deriveFirmMetadata(FIRM, "reasoning", "production");
    expect(metadata.firm_id).toBe("firm_abc");
    expect(metadata.slot).toBe("reasoning");
    expect(metadata.env).toBe("production");
  });

  it("never includes a model tag", () => {
    const metadata = deriveFirmMetadata(FIRM, "reasoning", "production");
    expect(metadata).not.toHaveProperty("model");
  });

  it("never exceeds 5 keys", () => {
    const metadata = deriveFirmMetadata(FIRM, "utility", "staging");
    expect(Object.keys(metadata).length).toBeLessThanOrEqual(5);
  });
});

describe("gatewayOptions", () => {
  it("assembles a complete options object with the gateway id and derived metadata", () => {
    const options = gatewayOptions(FIRM, "reasoning", "production");
    expect(options.id).toBe(GATEWAY_ID);
    expect(options.skipCache).toBe(true);
    expect(options.collectLog).toBe(false);
    expect(options.metadata.firm_id).toBe("firm_abc");
    expect(options.metadata.slot).toBe("reasoning");
    expect(options.metadata.env).toBe("production");
  });

  it("never sets a cacheKey property (a key alone caches even with skipCache:true)", () => {
    const options = gatewayOptions(FIRM, "reasoning", "production");
    expect(options).not.toHaveProperty("cacheKey");
  });
});

describe("assertZdrEligible (the fail-closed ZDR guard)", () => {
  it("returns null for a ZDR-eligible catalog model", () => {
    expect(assertZdrEligible("anthropic/claude-opus-5-5")).toBeNull();
  });

  it("returns a non-null problem for a model not in the catalog", () => {
    const problem = assertZdrEligible("anthropic/not-in-catalog");
    expect(problem).not.toBeNull();
  });

  it("returns a NON-retryable problem (category:validation) for an off-catalog model", () => {
    const problem = assertZdrEligible("anthropic/not-in-catalog");
    expect(problem?.retryable).toBe(false);
    expect(problem?.category).toBe("validation");
  });

  it("problem.detail is caller-safe text — never echoes the supplied model id back", () => {
    const problem = assertZdrEligible("anthropic/not-in-catalog");
    // The detail must not splice back the raw caller-supplied model id, which could echo tokens.
    expect(problem?.detail).not.toContain("anthropic/not-in-catalog");
  });
});

describe("zdrRejection", () => {
  it("wraps the ZDR guard into a typed adapter-error Dispatch", () => {
    const dispatch = zdrRejection("anthropic/not-in-catalog");
    expect(dispatch).toMatchObject({ ok: false, reason: "adapter-error" });
  });

  it("the problem inside the Dispatch is non-retryable with category:validation", () => {
    const dispatch = zdrRejection<string>("anthropic/not-in-catalog");
    if (dispatch.ok) throw new Error("expected failure");
    expect(dispatch.problem?.retryable).toBe(false);
    expect(dispatch.problem?.category).toBe("validation");
  });
});
