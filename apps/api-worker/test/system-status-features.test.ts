// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
/*
 * The feature roster's reading of the environment: a feature is set up when every name in one of
 * its alternatives is present, a present name is a binding or a non-empty string, a feature whose
 * Worker or outside service fails its probe is a fault rather than "not set up", and the operator's
 * report carries presence only — never a value.
 */
import { describe, expect, it } from "vitest";
import {
  FEATURE_ROSTER,
  featureRequirements,
  featureStatuses,
} from "../src/system-status/feature-roster.ts";
import { SERVICE_VERSION_ROSTER } from "../src/system-status/service-versions.ts";

const NO_PROBES = { workers: new Map(), connectedServices: new Map() } as const;

function stateOf(
  environment: Record<string, unknown>,
  id: string,
  probes: Parameters<typeof featureStatuses>[1] = NO_PROBES,
): string | undefined {
  return featureStatuses(environment, probes).find((feature) => feature.id === id)?.state;
}

describe("featureStatuses", () => {
  it("reports every rostered feature exactly once, in roster order", () => {
    expect(featureStatuses({}, NO_PROBES).map((feature) => feature.id)).toEqual(
      FEATURE_ROSTER.map((feature) => feature.id),
    );
  });

  it("an empty environment has nothing set up", () => {
    expect(featureStatuses({}, NO_PROBES).every((feature) => feature.state === "not-set-up")).toBe(
      true,
    );
  });

  it("needs every name in an alternative, not just one of them", () => {
    expect(stateOf({ MICROSOFT_CLIENT_ID: "id" }, "outlookCalendarSync")).toBe("not-set-up");
    expect(
      stateOf(
        { MICROSOFT_CLIENT_ID: "id", MICROSOFT_CLIENT_SECRET: "secret" },
        "outlookCalendarSync",
      ),
    ).toBe("working");
  });

  it("an empty string is a cleared variable, not a set one", () => {
    expect(stateOf({ TURNSTILE_SECRET_KEY: "  " }, "signUpBotCheck")).toBe("not-set-up");
  });

  it("either alternative sets address suggestions up", () => {
    expect(stateOf({ SMARTY_AUTH_ID: "a", SMARTY_AUTH_TOKEN: "b" }, "addressSuggestions")).toBe(
      "working",
    );
    expect(stateOf({ ADDRESS_SERVICE: {} }, "addressSuggestions")).toBe("working");
  });

  it("a set-up feature whose Worker does not answer is a fault", () => {
    const probes = {
      workers: new Map([["scan", "unreachable" as const]]),
      connectedServices: new Map(),
    };
    expect(stateOf({ SCAN_SERVICE: {} }, "malwareScanning", probes)).toBe("fault");
  });

  it("a set-up feature whose outside service refuses the credentials is a fault", () => {
    const probes = {
      workers: new Map(),
      connectedServices: new Map([["realtime", "refused" as const]]),
    };
    expect(
      stateOf({ REALTIME_SFU_APP_ID: "a", REALTIME_SFU_APP_SECRET: "b" }, "meetings", probes),
    ).toBe("fault");
  });

  it("names only Workers the version roster knows", () => {
    const known = new Set(SERVICE_VERSION_ROSTER.map((entry) => entry.id));
    for (const feature of FEATURE_ROSTER) {
      if ("worker" in feature) expect(known.has(feature.worker)).toBe(true);
    }
  });
});

describe("featureRequirements", () => {
  it("carries each name and whether it is present, and never the value", () => {
    const report = featureRequirements({ TELNYX_API_KEY: "a-real-looking-secret" });
    const caller = report.find((feature) => feature.id === "callerLookup");
    expect(caller?.alternatives).toEqual([[{ name: "TELNYX_API_KEY", present: true }]]);
    expect(JSON.stringify(report)).not.toContain("a-real-looking-secret");
  });
});
