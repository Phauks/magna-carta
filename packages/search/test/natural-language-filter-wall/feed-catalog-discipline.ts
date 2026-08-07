import type { FileId, MatterId } from "@magna-carta/identifiers/types";
import { feedObjectKey } from "./filter-construction.ts";

// The feed-catalog discipline the feed writer will live by, modeled runnably so its properties are
// pinned before the writer exists: one catalog row per fed object; deletion driven from the catalog
// and never from a prefix listing; matter reassignment as delete-old-key-plus-write-new-key; and a
// reconciliation that turns any catalog/bucket disagreement into a detected inconsistency rather than
// a silent miss. This is the half of deletion the platform can DEMONSTRATE — the managed index's own
// deletion latency is a live measurement, and until a removal has synced, the catalog (not the index)
// is what keeps a removed document out of results: a returned hit with no live catalog row is dropped.

export interface FeedCatalogRow {
  readonly fileId: FileId;
  readonly version: number;
  readonly matter: MatterId;
  readonly objectKey: string;
  readonly byteCount: number;
  readonly fedAt: number;
  readonly removedAt: number | undefined;
}

export class FeedCatalog {
  private readonly rows = new Map<string, FeedCatalogRow>();

  private static rowKey(fileId: FileId, version: number): string {
    return `${fileId}@${version}`;
  }

  recordFed(row: Omit<FeedCatalogRow, "removedAt">): void {
    this.rows.set(FeedCatalog.rowKey(row.fileId, row.version), { ...row, removedAt: undefined });
  }

  markRemoved(fileId: FileId, version: number, removedAt: number): void {
    const key = FeedCatalog.rowKey(fileId, version);
    const row = this.rows.get(key);
    if (row === undefined) return;
    this.rows.set(key, { ...row, removedAt });
  }

  allRows(): readonly FeedCatalogRow[] {
    return [...this.rows.values()];
  }

  liveRows(): readonly FeedCatalogRow[] {
    return this.allRows().filter((row) => row.removedAt === undefined);
  }

  liveRowForObjectKey(objectKey: string): FeedCatalogRow | undefined {
    return this.liveRows().find((row) => row.objectKey === objectKey);
  }

  // Deletion for a scope is planned FROM THE CATALOG: the keys to delete are the keys the catalog
  // says were fed. A listing is never the source, so an object the catalog does not know about is
  // surfaced by reconciliation below instead of being quietly swept along.
  deletionPlanForMatter(matter: MatterId): readonly string[] {
    return this.liveRows()
      .filter((row) => row.matter === matter)
      .map((row) => row.objectKey);
  }
}

// Matter reassignment: the feed copy carries the matter in its key precisely so it is cheap to move —
// the plan is always delete the old key, write the new one, update the row. The authoritative object
// never moves.
export interface ReassignmentPlan {
  readonly deleteObjectKey: string;
  readonly writeObjectKey: string;
}

export function reassignmentPlan(row: FeedCatalogRow, newMatter: MatterId): ReassignmentPlan {
  return {
    deleteObjectKey: row.objectKey,
    writeObjectKey: feedObjectKey(newMatter, row.fileId, row.version),
  };
}

// Reconciliation between the catalog and a bucket prefix listing. Either direction of disagreement is
// an inconsistency to report loudly: an object with no live row means something reached the feed
// prefix outside the writer (or a delete was recorded but never executed); a live row with no object
// means a write was recorded but the bytes are gone.
export interface ReconciliationReport {
  readonly consistent: boolean;
  readonly objectsWithoutLiveRow: readonly string[];
  readonly liveRowsWithoutObject: readonly string[];
}

export function reconcileCatalogAgainstListing(
  catalog: FeedCatalog,
  listedObjectKeys: readonly string[],
): ReconciliationReport {
  const listed = new Set(listedObjectKeys);
  const liveKeys = new Set(catalog.liveRows().map((row) => row.objectKey));
  const objectsWithoutLiveRow = [...listed].filter((key) => !liveKeys.has(key));
  const liveRowsWithoutObject = [...liveKeys].filter((key) => !listed.has(key));
  return {
    consistent: objectsWithoutLiveRow.length === 0 && liveRowsWithoutObject.length === 0,
    objectsWithoutLiveRow,
    liveRowsWithoutObject,
  };
}
