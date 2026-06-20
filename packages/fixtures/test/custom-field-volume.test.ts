import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ledgerVolume, scaleProfile } from "../src/load-profile/profile.ts";
import { loadProfileSnapshot, type LoadedSnapshot } from "../src/load-profile/snapshot.ts";

// The custom-field generator seeds the configured volume (fields on matter types + entity categories,
// picklist options, values on the busiest records) through the real write paths, and records the
// probes the measurement layer binds its reads to. Runs at the smoke scale so the suite stays fast.
const TINY = scaleProfile(ledgerVolume, 0.002);

describe("load-profile custom-field volume", () => {
  const temporaryDirectories: string[] = [];
  const openSnapshots: LoadedSnapshot[] = [];
  const track = (snapshot: LoadedSnapshot): LoadedSnapshot => {
    openSnapshots.push(snapshot);
    temporaryDirectories.push(dirname(snapshot.workingPath));
    return snapshot;
  };
  afterEach(() => {
    for (const snapshot of openSnapshots.splice(0)) {
      snapshot.close();
    }
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("seeds custom-field definitions and values and records probes", async () => {
    const cacheDirectory = mkdtempSync(join(tmpdir(), "mc-cf-cache-"));
    temporaryDirectories.push(cacheDirectory);
    const snapshot = track(
      await loadProfileSnapshot(TINY, "custom-field-seed", { allowSeeding: true, cacheDirectory }),
    );

    // Definitions + values were laid down.
    expect(snapshot.manifest.customFieldDefinitionCount).toBeGreaterThan(0);
    expect(snapshot.manifest.customFieldValueCount).toBeGreaterThan(0);

    // The probes resolve: the busiest record is a matter; the reference field and convert-scan field
    // are real custom-field handles; the convert-scan field actually carries current values.
    expect(snapshot.manifest.customFieldProbes.busiestRecordId).toMatch(/^matter_/);
    expect(snapshot.manifest.customFieldProbes.referenceFieldId).toMatch(/^customField_/);
    expect(snapshot.manifest.customFieldProbes.convertScanFieldId).toMatch(/^customField_/);

    const { results: probeValueRows } = await snapshot.database
      .prepare(
        "SELECT COUNT(*) AS n FROM custom_field_value WHERE target_row_id = ?1 AND is_current = 1",
      )
      .bind(snapshot.manifest.customFieldProbes.busiestRecordId)
      .all<{ n: number }>();
    expect(probeValueRows[0]!.n).toBeGreaterThan(0);

    const { results: convertScanRows } = await snapshot.database
      .prepare(
        "SELECT COUNT(*) AS n FROM custom_field_value WHERE field_id = ?1 AND is_current = 1",
      )
      .bind(snapshot.manifest.customFieldProbes.convertScanFieldId)
      .all<{ n: number }>();
    expect(convertScanRows[0]!.n).toBeGreaterThan(0);

    snapshot.close();
  });
});
