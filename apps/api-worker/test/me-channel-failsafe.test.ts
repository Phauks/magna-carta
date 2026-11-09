import { describe, expect, it } from "vitest";
import type { Bindings } from "../src/bindings.ts";
import { resolveChannelAndFlags } from "../src/http/routes/session/me.ts";
import type { FirmId } from "@magna-carta/identifiers/types";

// A control-plane binding whose channel read throws (e.g. "no such column: release_channel").
const throwingControlPlane = {
  prepare: () => ({
    bind: () => ({
      first: () => Promise.reject(new Error("no such column: release_channel")),
    }),
  }),
};
// No FLAGS binding -> default-off evaluator; firmId is a placeholder branded id.
const env = { DB_CONTROL: throwingControlPlane } as unknown as Bindings;
const firmId = "firm_failsafe_test" as unknown as FirmId;

describe("resolveChannelAndFlags fail-safe", () => {
  it("degrades to stable + default flags when the channel read throws", async () => {
    const result = await resolveChannelAndFlags(env, "usr_1", firmId);
    expect(result.channel).toBe("stable");
    expect(result.flags).toEqual({ "release-channels.smoke": false });
  });
});
