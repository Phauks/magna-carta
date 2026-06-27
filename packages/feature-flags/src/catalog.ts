// A feature's maturity. The client marks anything enabled whose stage is not "stable" as in active
// development; graduating a feature to "stable" (or removing its flag) clears that marker — the
// visibility lifecycle is the rollout lifecycle.
export type FlagStage = "alpha" | "beta" | "stable";

// The known boolean flags the bootstrap evaluates and ships to the client. Each entry names its
// safe default (stable behavior) and its stage. v1 carries one throwaway flag that proves the
// evaluation path end to end; real features add their own entry here as they adopt the rails.
export const FLAG_CATALOG: Record<
  string,
  { readonly defaultValue: boolean; readonly stage: FlagStage; readonly description: string }
> = {
  "release-channels.smoke": {
    defaultValue: false,
    stage: "beta",
    description:
      "Wiring smoke test for the release-channels evaluation path; not a product feature.",
  },
};
