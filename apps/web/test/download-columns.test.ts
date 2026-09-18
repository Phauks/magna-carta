/*
 * The download register's column model, pinned where a quiet mistake would be invisible on screen
 * and wrong in a way a person would act on: a row that says it can be taken again when it cannot,
 * a vocabulary that goes missing because nothing on screen happens to carry it, and a size or a
 * date printed as a figure where there is no figure to print.
 */
import { describe, expect, it } from "vitest";
import {
  downloadRegisterColumns,
  downloadStanding,
  isTakeable,
  DOWNLOAD_COLUMN_IDENTIFIERS,
  PRODUCER_CHOICES,
  STANDING_CHOICES,
} from "../src/lib/export/download-columns.ts";
import type { ShelfItem } from "../src/lib/export/download-shelf.ts";

function download(overrides: Partial<ShelfItem> = {}): ShelfItem {
  return {
    id: "downloadItem_one",
    title: "Firm Usage",
    kind: "snapshot",
    subjectFileId: null,
    producer: "export",
    byteSize: null,
    requestedFormat: "xlsx",
    downloadedFormats: [],
    createdAt: "2026-09-16T09:00:00.000Z",
    expiresAt: "2026-09-23T09:00:00.000Z",
    state: "ready",
    ...overrides,
  };
}

const columnsById = new Map(downloadRegisterColumns().map((column) => [column.id, column]));

function textOf(id: string, item: ShelfItem): string {
  const column = columnsById.get(id);
  if (column === undefined) throw new Error(`no column ${id}`);
  const value = column.text?.(item) ?? column.value(item);
  return value == null ? "" : String(value);
}

describe("what a row's standing says", () => {
  it("reads a matter file as the matter's, never as the register's", () => {
    const row = download({ kind: "reference", subjectFileId: "file_one", expiresAt: null });
    expect(downloadStanding(row)).toBe("On the matter");
    // Takeable, because the file is still reachable — through the matter, which re-checks access.
    expect(isTakeable(row)).toBe(true);
  });

  it("reads bytes that were never kept as a record, not as something expired", () => {
    // A bundle streamed straight to the member: it assembled its bytes for one response and
    // retained none, so there is nothing to come back to and nothing that ever expired.
    const row = download({ kind: "record", producer: "bundle", expiresAt: null, state: "ready" });
    expect(downloadStanding(row)).toBe("Record only");
    expect(isTakeable(row)).toBe(false);
  });

  it("separates work still running from work that is there", () => {
    expect(downloadStanding(download({ kind: "artifact", state: "building" }))).toBe("Preparing");
    expect(isTakeable(download({ kind: "artifact", state: "building" }))).toBe(false);
    expect(downloadStanding(download({ kind: "artifact", state: "ready" }))).toBe("Available");
    expect(isTakeable(download({ kind: "artifact", state: "ready" }))).toBe(true);
  });

  it("reads a released copy as a record rather than as still available", () => {
    expect(downloadStanding(download({ kind: "artifact", state: "expired" }))).toBe("Record only");
    expect(isTakeable(download({ kind: "artifact", state: "expired" }))).toBe(false);
  });
});

describe("the columns", () => {
  it("anchors on the name, so the register is never a list of dates", () => {
    expect(columnsById.get(DOWNLOAD_COLUMN_IDENTIFIERS.title)?.anchored).toBe(true);
  });

  it("declares both vocabularies, so a filter never drops a value nothing loaded carries", () => {
    expect(columnsById.get(DOWNLOAD_COLUMN_IDENTIFIERS.producer)?.filterValues).toEqual(
      PRODUCER_CHOICES,
    );
    expect(columnsById.get(DOWNLOAD_COLUMN_IDENTIFIERS.standing)?.filterValues).toEqual(
      STANDING_CHOICES,
    );
  });

  it("leaves a size blank where there is no size, rather than printing a zero", () => {
    expect(textOf(DOWNLOAD_COLUMN_IDENTIFIERS.byteSize, download({ byteSize: null }))).toBe("");
    expect(textOf(DOWNLOAD_COLUMN_IDENTIFIERS.byteSize, download({ byteSize: 2048 }))).toBe(
      "2.0 KB",
    );
  });

  it("says Gone rather than a date once the copy has been released", () => {
    expect(textOf(DOWNLOAD_COLUMN_IDENTIFIERS.expiresAt, download({ state: "expired" }))).toBe(
      "Gone",
    );
    // And nothing at all where there was never a copy of the register's to release.
    expect(
      textOf(
        DOWNLOAD_COLUMN_IDENTIFIERS.expiresAt,
        download({ kind: "reference", expiresAt: null }),
      ),
    ).toBe("");
  });

  it("carries the actions at the trailing edge, holding no value of its own", () => {
    const actions = columnsById.get(DOWNLOAD_COLUMN_IDENTIFIERS.actions);
    expect(actions?.pinnedEnd).toBe(true);
    expect(actions?.filter).toBe("none");
    expect(actions?.value(download())).toBeNull();
  });
});
