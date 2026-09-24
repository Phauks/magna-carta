import { describe, expect, it } from "vitest";
import {
  QUIET_ZONE_MODULES,
  darkModulePath,
  qrGeometry,
} from "../src/lib/components/qr-code/qr-code-model.ts";

describe("QR code geometry", () => {
  it("draws each run of dark modules along a row as one rectangle", () => {
    const matrix = [
      [true, true, false, true],
      [false, false, false, false],
      [false, true, true, true],
    ];
    expect(darkModulePath(matrix, 0)).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 2h3v1h-3z");
  });

  it("offsets every rectangle by the quiet zone", () => {
    expect(darkModulePath([[true]], QUIET_ZONE_MODULES)).toBe("M4 4h1v1h-1z");
  });

  it("draws nothing for a row with no dark modules", () => {
    expect(darkModulePath([[false, false]], 0)).toBe("");
  });

  it("leaves a four-module quiet zone on every side of the symbol", () => {
    const geometry = qrGeometry("otpauth://totp/Magna%20Carta:joan%40example.test?secret=JBSWY3DP");
    const coordinates = [...geometry.path.matchAll(/M(\d+) (\d+)h(\d+)/g)].map((match) => ({
      column: Number(match[1]),
      row: Number(match[2]),
      run: Number(match[3]),
    }));
    expect(coordinates.length).toBeGreaterThan(0);
    const farEdge = geometry.extent - QUIET_ZONE_MODULES;
    for (const { column, row, run } of coordinates) {
      expect(column).toBeGreaterThanOrEqual(QUIET_ZONE_MODULES);
      expect(row).toBeGreaterThanOrEqual(QUIET_ZONE_MODULES);
      expect(column + run).toBeLessThanOrEqual(farEdge);
      expect(row + 1).toBeLessThanOrEqual(farEdge);
    }
    // The finder pattern's top edge: seven dark modules starting at the quiet zone's corner.
    expect(geometry.path.startsWith(`M${QUIET_ZONE_MODULES} ${QUIET_ZONE_MODULES}h7`)).toBe(true);
  });
});
