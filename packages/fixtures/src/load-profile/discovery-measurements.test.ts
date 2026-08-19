import { describe, expect, it } from "vitest";
import { createMigratedNodeDatabase } from "@magna-carta/database/node-sqlite";
import {
  DISCOVERY_VOLUMES,
  seedDiscoveryVolume,
  type DiscoveryProbes,
  type DiscoveryVolumeProfile,
} from "./discovery-generate.ts";
import {
  DISCOVERY_ALLOWED_SCANS,
  discoveryHotPathPlans,
  discoveryMeasurements,
  measuredDatabaseSizeMebibytes,
  type DiscoveryHandle,
} from "./discovery-measurements.ts";
import { findFullScans, findTempBtreeSorts, runMeasurements } from "./runner.ts";

// The discovery corpus at volume: the review-document list page the whole review surface pages
// through, the exception surface, the occurrence read, the corpus split catalog, and the processing
// lane's own volume-shaped operations.
//
// TWO VOLUMES, and only one of them runs by default. The standard volume is the 25,000-document
// review set the design states its arithmetic at; the large volume is the 250,000-document ceiling
// the arithmetic ends at, and the point of running it is that the ceiling then rests on a measured
// database size rather than on an extrapolation from a tenth of it. It seeds a quarter of a million
// documents, so it runs when asked for — `MAGNA_CARTA_DISCOVERY_VOLUME=large` — rather than on every
// test run.
//
// The numbers are PRINTED, never asserted against a threshold. They are machine-relative: they decide
// regressions and growth curves across commits on one machine, never an absolute latency, and never a
// pass/fail gate that would turn a busy laptop into a red build. What IS asserted is plan shape, which
// is timing-noise-free.

const requested = process.env["MAGNA_CARTA_DISCOVERY_VOLUME"] === "large" ? "large" : "standard";
const profile: DiscoveryVolumeProfile = DISCOVERY_VOLUMES[requested];

function seeded(): { readonly handle: DiscoveryHandle; readonly close: () => void } {
  const { raw } = createMigratedNodeDatabase("per-firm");
  const probes: DiscoveryProbes = seedDiscoveryVolume(raw, profile);
  return { handle: { raw, profile, probes }, close: () => raw.close() };
}

describe(`discovery at ${profile.name} volume (load profile)`, () => {
  // Seeding a quarter of a million documents takes tens of seconds; the default five-second timeout
  // is for tests that do not build a corpus first.
  const timeoutMs = profile.reviewDocumentCount > 50_000 ? 300_000 : 30_000;

  it(
    "every volume-shaped read walks an index, and every paged walk sorts from one",
    () => {
      const { handle, close } = seeded();
      const plans = discoveryHotPathPlans(handle.raw, handle.profile, handle.probes);

      // A scan here is a read whose cost is the corpus rather than the page. The allowlist is the two
      // whole-set aggregates, each of which scans by nature and is named where it is allowed.
      expect(findFullScans(plans, DISCOVERY_ALLOWED_SCANS)).toEqual([]);

      // AND NO TEMPORARY SORT, on any of them. This is the assertion the list page exists to satisfy:
      // an index that stopped at the filter column would satisfy every WHERE above and leave the
      // ORDER BY to a b-tree over a quarter-million rows built fresh on every page — which is fast on a
      // demo corpus and is the whole difference between a keyset cursor and a lie about one.
      expect(findTempBtreeSorts(plans)).toEqual([]);

      close();
    },
    timeoutMs,
  );

  it(
    "reports the measured cost of each volume-shaped operation, and the database size the ceiling rests on",
    async () => {
      const { handle, close } = seeded();
      const measurements = discoveryMeasurements();
      const results = await runMeasurements(handle, measurements, {
        warmupIterations: 5,
        iterations: 25,
      });

      for (const result of results) {
        // eslint-disable-next-line no-console
        console.log(
          `${result.name}: median ${result.medianMs}ms p95 ${result.p95Ms}ms min ${result.minMs}ms`,
        );
      }
      expect(results).toHaveLength(measurements.length);

      // THE NUMBER THE CEILING IS DERIVED FROM. Printed beside the corpus that produced it, so the
      // ceiling is re-derived against a measurement rather than defended by argument.
      // eslint-disable-next-line no-console
      console.log(
        `${profile.name}: ${handle.probes.reviewDocumentCount} review documents, ` +
          `${handle.probes.exceptionCount} exceptions, ${handle.probes.occurrenceCount} occurrences — ` +
          `database ${measuredDatabaseSizeMebibytes(handle.raw)} MiB`,
      );

      close();
    },
    timeoutMs,
  );
});
