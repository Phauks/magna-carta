import { describe, expect, it } from "vitest";
import {
  connectedServiceRow,
  connectedServicesSectionPills,
} from "../src/lib/versions/connected-services-model.ts";

describe("connected services model", () => {
  it("says a connected Realtime is healthy", () => {
    const row = connectedServiceRow({
      id: "realtime",
      state: "connected",
      latencyMilliseconds: 80,
    });
    expect(row).toMatchObject({ status: "Connected", reading: "healthy" });
  });

  it("names a refused credential as a fault", () => {
    const row = connectedServiceRow({ id: "realtime", state: "refused", latencyMilliseconds: 40 });
    expect(row).toMatchObject({ status: "Refused", reading: "fault" });
  });

  it("names the calendar provider and its settings on a calendar row", () => {
    const refused = connectedServiceRow({
      id: "googleCalendar",
      state: "refused",
      latencyMilliseconds: 120,
    });
    expect(refused).toMatchObject({ name: "Google (calendar sync)", reading: "fault" });
    expect(refused.detail).toContain("client ID and secret");
    const missing = connectedServiceRow({
      id: "microsoftCalendar",
      state: "not-configured",
      latencyMilliseconds: null,
    });
    expect(missing.detail).toContain("MICROSOFT_CLIENT_ID");
  });

  it("counts what is not working on the shut heading", () => {
    expect(
      connectedServicesSectionPills([
        { id: "realtime", state: "not-configured", latencyMilliseconds: null },
      ]).map((pill) => pill.label),
    ).toEqual(["1 service", "1 not working"]);
  });
});
