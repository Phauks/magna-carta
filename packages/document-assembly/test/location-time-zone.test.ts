import { describe, expect, it } from "vitest";
import { formatMergeValue } from "../src/format.ts";
import { toLocationMergeRow, type LocationMergeColumns } from "../src/merge-statements.ts";
import { timeZoneForLocation } from "../src/resolve.ts";

// The office's own zone is the one thing that decides what date a document prints. It enters the
// platform HERE and nowhere else.

const OFFICE: LocationMergeColumns = {
  id: "location_reno00000000000000000",
  name: "Reno",
  jurisdiction: "US-NV",
  time_zone: null,
  address_block: null,
  footer: null,
  remit_to: null,
  letterhead_logo_object_key: null,
  letterhead_logo_width_emu: null,
};

describe("the office's time zone reaches the formatters", () => {
  it("renders a date in the office's own zone", () => {
    const office = toLocationMergeRow({ ...OFFICE, time_zone: "America/Los_Angeles" });
    const zone = timeZoneForLocation(office);
    expect(zone).toBe("America/Los_Angeles");
    // An instant just after midnight UTC is still the previous day in the office that filed it.
    expect(
      formatMergeValue({ kind: "instant", isoInstant: "2026-08-06T02:00:00.000Z" }, "iso", {
        timeZone: zone,
      }),
    ).toBe("2026-08-05");
  });

  it("is byte-identical to the previous behavior for an office that carries no zone", () => {
    const office = toLocationMergeRow(OFFICE);
    expect(timeZoneForLocation(office)).toBe("UTC");
    expect(timeZoneForLocation(undefined)).toBe("UTC");
    expect(
      formatMergeValue({ kind: "instant", isoInstant: "2026-08-06T02:00:00.000Z" }, "iso", {
        timeZone: timeZoneForLocation(office),
      }),
    ).toBe("2026-08-06");
  });

  it("treats an empty stored zone as no zone rather than as a zone nothing can resolve", () => {
    expect(timeZoneForLocation(toLocationMergeRow({ ...OFFICE, time_zone: "" }))).toBe("UTC");
  });
});
