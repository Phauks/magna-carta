import { describe, it, expect } from "vitest";
import { rankedVerifiedOffers, BENCHMARK_SHORTLIST } from "../src/offer-filter.ts";
import type { VastOffer } from "../src/vast-client.ts";

const offer = (o: Partial<VastOffer>): VastOffer => ({
  offerId: 1,
  gpuName: "RTX 4090",
  gpuCount: 1,
  gpuRamMegabytes: 24576,
  dollarsPerHour: 0.4,
  reliability: 0.99,
  verified: true,
  ...o,
});

describe("offer-filter", () => {
  it("shortlist is 4090-centric with a datacenter comparison", () => {
    expect(BENCHMARK_SHORTLIST.some((s) => s.gpuName === "RTX 4090" && s.gpuCount === 1)).toBe(
      true,
    );
    expect(BENCHMARK_SHORTLIST.some((s) => s.gpuName === "H100 SXM")).toBe(true);
  });
  it("rankedVerifiedOffers returns matching, verified, reliable offers cheapest-first", () => {
    const ranked = rankedVerifiedOffers(
      [
        offer({ offerId: 1, dollarsPerHour: 0.5 }),
        offer({ offerId: 2, dollarsPerHour: 0.3 }),
        offer({ offerId: 3, dollarsPerHour: 0.9 }),
        offer({ offerId: 4, verified: false, dollarsPerHour: 0.1 }),
        offer({ offerId: 5, reliability: 0.5, dollarsPerHour: 0.05 }),
        offer({ offerId: 6, gpuName: "RTX 5090", dollarsPerHour: 0.01 }),
      ],
      { gpuName: "RTX 4090", gpuCount: 1 },
      0.95,
    );
    expect(ranked.map((entry) => entry.offerId)).toEqual([2, 1, 3]);
  });

  it("rankedVerifiedOffers returns an empty array when nothing qualifies", () => {
    expect(
      rankedVerifiedOffers([offer({ verified: false })], { gpuName: "RTX 4090", gpuCount: 1 }, 0.95),
    ).toEqual([]);
  });
});
