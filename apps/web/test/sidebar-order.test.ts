/*
 * The reconciliation-merge rule, pinned: a starred destination the member has never arranged
 * enters at its CANONICAL position relative to the member's own arrangement; retired ids drop;
 * the fixed leader (Home) outranks everything. This is the rule that makes new registry
 * additions land predictably even in heavily customized sidebars.
 */

import { describe, expect, it } from "vitest";
import { FIXED_LEADING_ID, mergeGroupOrder } from "../src/lib/navigation/sidebar-order.ts";

describe("mergeGroupOrder — sidebar reconciliation", () => {
  it("returns the canonical order when nothing is stored", () => {
    expect(mergeGroupOrder(["home", "alpha", "beta"], [])).toEqual(["home", "alpha", "beta"]);
  });

  it("keeps the member's stored arrangement for arranged ids", () => {
    expect(
      mergeGroupOrder(["home", "alpha", "beta", "gamma"], ["home", "gamma", "alpha", "beta"]),
    ).toEqual(["home", "gamma", "alpha", "beta"]);
  });

  it("seats an unarranged id at its canonical position within the arrangement", () => {
    // "beta" is new to this member's order; canonically it follows "alpha", so it enters right
    // after "alpha" (its nearest canonical predecessor in the arrangement) — never leaping over
    // the member's deliberately-placed "gamma" to the front.
    expect(mergeGroupOrder(["alpha", "beta", "gamma"], ["gamma", "alpha"])).toEqual([
      "gamma",
      "alpha",
      "beta",
    ]);
  });

  it("appends an unarranged id that canonically follows everything arranged", () => {
    expect(mergeGroupOrder(["alpha", "beta", "omega"], ["beta", "alpha"])).toEqual([
      "beta",
      "alpha",
      "omega",
    ]);
  });

  it("drops stored ids that are no longer visible, without disturbing the rest", () => {
    expect(mergeGroupOrder(["alpha", "beta"], ["retired", "beta", "alpha"])).toEqual([
      "beta",
      "alpha",
    ]);
  });

  it("forces the fixed leader to the front regardless of the stored arrangement", () => {
    expect(
      mergeGroupOrder([FIXED_LEADING_ID, "alpha", "beta"], ["beta", FIXED_LEADING_ID, "alpha"]),
    ).toEqual([FIXED_LEADING_ID, "beta", "alpha"]);
  });
});
