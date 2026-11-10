import { recordIndexRebuiltAuditStatement } from "@magna-carta/search/record-index-rebuild";
import {
  optimizeRecordIndexStatement,
  readRecordIndexPlaces,
  rebuildRecordIndexSourceStatements,
  recordIndexPlaceIsBehind,
} from "@magna-carta/search/record-index-statements";
import type { Logger } from "@magna-carta/telemetry/logger";
import { logOperationFailed } from "@magna-carta/telemetry/operation";
import type { ProxyBatchDatabase } from "../firm-database/firm-database-proxy.ts";

// The rebuild of a firm's record index, run from the per-firm queue when a member has asked for it
// on the Search and Indexing page.
//
// IT DECIDES WHAT TO REBUILD WHEN IT RUNS. It counts every place's index rows beside the records
// that belong in the index, with the read the settings page shows, and rebuilds exactly the places
// whose counts differ. Nothing is carried from the request, so a message that arrives late, or
// twice, does the work that is needed at that moment: the second delivery counts, finds nothing
// behind and rebuilds nothing.
//
// ONE PLACE, ONE TRANSACTION. A place is emptied and derived again in a single batch, so a search
// never reads a place half rebuilt. The places are separate batches so that one large place does not
// hold every other place inside its transaction; a failure part way leaves the earlier places
// rebuilt and the message retried, which counts again and carries on from what is still behind.
//
// WHAT IT COSTS: the count reads every indexed record once, and a rebuild re-reads the records of
// the place it takes. The fill this repeats took four to six seconds per 200,000 records when the
// index's shape was measured (packages/search/scripts/measure-record-index-shapes.mjs), which is
// why this runs here and never on a request.

/** The keys of the places a rebuild took, in the order the places are declared. */
export async function rebuildRecordIndexPlacesBehind(
  firmDatabase: ProxyBatchDatabase,
  logger: Logger,
): Promise<readonly string[]> {
  const places = await readRecordIndexPlaces(firmDatabase);
  const behind = places.filter(recordIndexPlaceIsBehind).map((place) => place.sourceKey);

  for (const sourceKey of behind) {
    await firmDatabase.batch(rebuildRecordIndexSourceStatements(firmDatabase, sourceKey));
  }

  // The record that a rebuild ran to its end, written after the last place and never before: the
  // settings page reads a request with no finish after it as a rebuild still to run. It is written
  // when nothing was behind too, because that is also an answer to the member who asked.
  await firmDatabase.batch([
    recordIndexRebuiltAuditStatement(firmDatabase, {
      places: behind,
      now: new Date().toISOString(),
    }),
  ]);

  if (behind.length > 0) {
    // Emptying a place leaves markers beside its old terms until the index next reorganizes itself.
    // Compacting now is housekeeping and not part of the repair: the places are already correct and
    // recorded as rebuilt, so a failure here is logged and the message is not retried for it.
    try {
      await optimizeRecordIndexStatement(firmDatabase).run();
    } catch (caught) {
      logOperationFailed(logger, "search:record-index-optimize", caught);
    }
  }
  logger.count("search.record_index.places_rebuilt", {}, behind.length);
  return behind;
}
