// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
import { describe, expect, it } from "vitest";
import { isFeatureKey } from "@magna-carta/telemetry/usage-features";
import {
  ROUTE_FEATURE,
  TOPIC_FEATURE,
  routeFeature,
  topicFeature,
} from "../../src/usage/feature-map.ts";

describe("feature maps", () => {
  it("maps a known route template to its feature", () => {
    expect(routeFeature("/api/v1/matters")).toBe("matters.list");
  });
  it("maps a known outbox topic to its feature", () => {
    expect(topicFeature("matter.closed")).toBe("matters.detail");
  });
  it("returns null for an unmapped route or topic", () => {
    expect(routeFeature("/api/v1/unmapped")).toBeNull();
    expect(topicFeature("nothing.here")).toBeNull();
  });
  it("only references registered feature keys", () => {
    for (const key of [...Object.values(ROUTE_FEATURE), ...Object.values(TOPIC_FEATURE)]) {
      expect(isFeatureKey(key)).toBe(true);
    }
  });
});
