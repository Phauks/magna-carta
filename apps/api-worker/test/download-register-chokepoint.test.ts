// @node-runtime — reaches no Workers runtime API; see vitest.node-runtime.ts.
/*
 * The one place a register row is made, and the rules it derives rather than trusts.
 *
 * `registerDownload` exists so that seven delivery lanes cannot each decide for themselves what
 * they just handed over. The facts it derives are the ones that would be wrong quietly: the KIND,
 * whether a key is carried, whether a matter file is named, and when the bytes let go. Two of those
 * are safety rather than tidiness —
 *
 *   - a matter file must never carry an object key, because a key is what the fetch route presigns,
 *     and a presigned matter file from a register row is a standing grant that survives the member
 *     losing access to the matter;
 *   - a download whose bytes were never retained must not claim an expiry, because that is a promise
 *     about an object that does not exist.
 *
 * The schema states both as CHECKs, so this is the near side of a guard the database also holds; the
 * point of testing it here is that a caller gets the refusal at the type and the row shape rather
 * than as a constraint violation in production.
 */
import { describe, expect, it } from "vitest";
import {
  registerDownload,
  SHELF_RETENTION_DAYS,
  type DownloadRegistration,
} from "../src/downloads/download-register.ts";

const NOW = new Date("2026-09-16T12:00:00.000Z");
const MEMBER = "user_member000000000000000001";

/**
 * The statement is opaque, so the row is read off what the insert was BOUND to. The binding order is
 * the insert's own column order — asserting through it is what makes this a test of the derivation
 * rather than a restatement of it.
 */
function boundRow(registration: DownloadRegistration): Record<string, unknown> {
  const bindings: unknown[] = [];
  const database = {
    prepare: () => ({
      bind: (...values: unknown[]) => {
        bindings.push(...values);
        return {};
      },
    }),
  };
  registerDownload(database as never, { memberId: MEMBER, now: NOW, registration });
  const [
    id,
    memberId,
    title,
    kind,
    producer,
    objectKey,
    subjectFileId,
    byteSize,
    requestedFormat,
    createdAt,
    expiresAt,
    state,
  ] = bindings;
  return {
    id,
    memberId,
    title,
    kind,
    producer,
    objectKey,
    subjectFileId,
    byteSize,
    requestedFormat,
    createdAt,
    expiresAt,
    state,
  };
}

describe("a matter file", () => {
  const row = boundRow({
    producer: "file",
    title: "Engagement letter.pdf",
    fileId: "file_000000000000000000000001",
    byteSize: 4096,
  });

  it("is a reference, and carries NO object key", () => {
    // The whole safety argument: no key means the presigning branch cannot be reached with it.
    expect(row.kind).toBe("reference");
    expect(row.objectKey).toBeNull();
    expect(row.subjectFileId).toBe("file_000000000000000000000001");
  });

  it("never expires, because the bytes are the matter's rather than the register's", () => {
    expect(row.expiresAt).toBeNull();
    expect(row.state).toBe("ready");
  });
});

describe("a bundle", () => {
  it("that was retained is an artifact pointing at it, and lets go on the shelf's schedule", () => {
    const row = boundRow({
      producer: "bundle",
      title: "Rivera files.zip",
      bytes: { retained: true, objectKey: "bundles/abc.zip", byteSize: 1024 },
    });
    expect(row.kind).toBe("artifact");
    expect(row.objectKey).toBe("bundles/abc.zip");
    expect(row.subjectFileId).toBeNull();
    expect(row.expiresAt).toBe(
      new Date(NOW.getTime() + SHELF_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString(),
    );
  });

  it("that was streamed is a record: nothing to come back to, and no expiry to promise", () => {
    const row = boundRow({
      producer: "bundle",
      title: "Rivera files.zip",
      bytes: { retained: false },
    });
    expect(row.kind).toBe("record");
    expect(row.objectKey).toBeNull();
    expect(row.expiresAt).toBeNull();
    expect(row.state).toBe("ready");
  });

  it("named before it is built shows as building", () => {
    const row = boundRow({
      producer: "bundle",
      title: "Rivera files.zip",
      bytes: { retained: true, objectKey: "bundles/abc.zip", byteSize: null },
      building: true,
    });
    expect(row.state).toBe("building");
    expect(row.objectKey).toBe("bundles/abc.zip");
  });
});

describe("the other producers", () => {
  it("keep an export's chosen format, and give one to nothing else", () => {
    expect(
      boundRow({
        producer: "export",
        title: "Matters docket",
        objectKey: "downloads/snapshots/one.json",
        requestedFormat: "xlsx",
      }).requestedFormat,
    ).toBe("xlsx");
    expect(
      boundRow({
        producer: "conversion",
        title: "Converted file (DOCX to PDF)",
        objectKey: "conversions/firm/job/result",
        byteSize: null,
      }).requestedFormat,
    ).toBeNull();
  });

  it("store an export as a snapshot with no size, because nothing has been rendered yet", () => {
    const row = boundRow({
      producer: "export",
      title: "Matters docket",
      objectKey: "downloads/snapshots/one.json",
      requestedFormat: "xlsx",
    });
    expect(row.kind).toBe("snapshot");
    expect(row.byteSize).toBeNull();
  });

  it("treat a discovery artifact as the retained bytes it is", () => {
    const row = boundRow({
      producer: "discovery",
      title: "Load manifest (JSON)",
      objectKey: "discovery/loads/one/manifest.json",
      byteSize: 512,
    });
    expect(row.kind).toBe("artifact");
    expect(row.producer).toBe("discovery");
    expect(row.objectKey).toBe("discovery/loads/one/manifest.json");
    expect(row.state).toBe("ready");
  });
});

describe("every kind", () => {
  const every: DownloadRegistration[] = [
    { producer: "file", title: "a", fileId: "file_1", byteSize: null },
    { producer: "bundle", title: "b", bytes: { retained: false } },
    { producer: "bundle", title: "c", bytes: { retained: true, objectKey: "k", byteSize: null } },
    { producer: "export", title: "d", objectKey: "k", requestedFormat: "csv" },
    { producer: "conversion", title: "e", objectKey: "k", byteSize: null },
    { producer: "discovery", title: "f", objectKey: "k", byteSize: null },
  ];

  it("names a file exactly when it carries no key — the schema's own biconditional", () => {
    for (const registration of every) {
      const row = boundRow(registration);
      const namesFile = row.subjectFileId !== null;
      const holdsKey = row.objectKey !== null;
      // A row may name a file, or hold a key, or neither (a record) — never both.
      expect(namesFile && holdsKey).toBe(false);
      if (namesFile) expect(row.kind).toBe("reference");
    }
  });

  it("carries the member and the instant it was handed over", () => {
    for (const registration of every) {
      const row = boundRow(registration);
      expect(row.memberId).toBe(MEMBER);
      expect(row.createdAt).toBe(NOW.toISOString());
      expect(String(row.id).startsWith("downloadItem_")).toBe(true);
    }
  });
});
