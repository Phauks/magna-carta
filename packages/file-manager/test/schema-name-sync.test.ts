// @repo-wide-fitness scope=schema — the statements are here, the tables they name are in
// packages/database, so the diff that renames one never touches this package.
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { MEMBER_TABLE } from "@magna-carta/data-access/member-statements";
import type { SqlDatabase, SqlStatement } from "@magna-carta/data-access/idempotency-statements";
import {
  documentType,
  file,
  fileVersion,
  folder,
  member,
  storageMeter,
  uploadSession,
  fileVersionParticipant,
} from "@magna-carta/database/per-firm-schema";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPE_TABLE,
  deactivateDocumentTypeStatement,
  insertDocumentTypeStatement,
  selectDocumentTypeIdByCodeStatement,
  selectDocumentTypeIdByNameStatement,
  selectDocumentTypeStatement,
  updateDocumentTypeStatement,
} from "../src/document-type-statements.ts";
import {
  FILE_TABLE,
  FILE_VERSION_TABLE,
  UPLOAD_SESSION_TABLE,
  abandonVersionStatement,
  assignDocumentTypeStatement,
  bumpFileCurrentVersionStatement,
  commitVersionStatement,
  insertFileStatement,
  insertFileVersionStatement,
  insertUploadSessionStatement,
  moveFileStatement,
  quarantineVersionStatement,
  renameFileStatement,
  selectCurrentVersionHashStatement,
  selectFileStatement,
  selectFolderFileStatement,
  selectMaxVersionNumberStatement,
  selectPendingVersionStatement,
  setUploadSessionStatusStatement,
  softDeleteFileStatement,
  FILE_VERSION_PARTICIPANT_TABLE,
} from "../src/file-statements.ts";
import {
  FOLDER_TABLE,
  deleteFolderStatement,
  insertFolderStatement,
  moveFolderStatement,
  renameFolderStatement,
  selectFolderChildFolderStatement,
  selectFolderIdByNameStatement,
  selectFolderStatement,
} from "../src/folder-statements.ts";
import { STORAGE_METER_TABLE, meterCommitStatements } from "../src/metering-statements.ts";
import {
  listCleanVersionsStatement,
  listFilesStatement,
  selectCurrentCleanVersionStatement,
  selectFileSummaryStatement,
  selectUploadSessionStatusStatement,
} from "../src/queries.ts";

function stubDatabase(): SqlDatabase {
  const statement = (sql: string): SqlStatement => ({
    sql,
    bind: () => statement(sql),
    run: () => Promise.resolve({ meta: { changes: 0 } }),
    all: <T>() => Promise.resolve({ results: [] as T[] }),
    first: () => Promise.resolve(null),
  });
  return { prepare: statement };
}

const sqlOf = (s: SqlStatement): string => s.sql ?? "";
const columnsOf = (table: Parameters<typeof getTableConfig>[0]): Set<string> =>
  new Set(getTableConfig(table).columns.map((c) => c.name));
const identifiers = (sql: string) =>
  sql.replace(/'(?:[^']|'')*'/g, " ").match(/\b[a-z_][a-z0-9_]*\b/g) ?? [];

function expectKnown(sql: string, allowed: ReadonlySet<string>, label: string) {
  for (const id of identifiers(sql)) {
    if (allowed.has(id)) continue;
    expect.fail(`${label} SQL names unknown identifier "${id}"`);
  }
}

const F = "file_x" as never;
const V = "fileVersion_x" as never;
const FOLD = "folder_x" as never;
const M = "matter_x" as never;

describe("schema name sync (file-manager SQL pinned to @magna-carta/database)", () => {
  it("table-name constants match the drizzle schema", () => {
    expect(getTableConfig(folder).name).toBe(FOLDER_TABLE);
    expect(getTableConfig(file).name).toBe(FILE_TABLE);
    expect(getTableConfig(fileVersion).name).toBe(FILE_VERSION_TABLE);
    expect(getTableConfig(uploadSession).name).toBe(UPLOAD_SESSION_TABLE);
    expect(getTableConfig(documentType).name).toBe(DOCUMENT_TYPE_TABLE);
    expect(getTableConfig(storageMeter).name).toBe(STORAGE_METER_TABLE);
  });

  it("folder SQL names only schema identifiers", () => {
    const stub = stubDatabase();
    const sql = [
      sqlOf(
        insertFolderStatement(stub, {
          id: FOLD,
          matterId: M,
          parentFolderId: null,
          name: "n",
          createdAt: "t",
        }),
      ),
      sqlOf(renameFolderStatement(stub, FOLD, "n", "t")),
      sqlOf(moveFolderStatement(stub, FOLD, null, "t")),
      sqlOf(deleteFolderStatement(stub, FOLD)),
      sqlOf(selectFolderStatement(stub, FOLD)),
      sqlOf(selectFolderIdByNameStatement(stub, M, null, "n")),
      sqlOf(selectFolderIdByNameStatement(stub, M, FOLD, "n")),
      sqlOf(selectFolderChildFolderStatement(stub, FOLD)),
    ].join("\n");
    expectKnown(
      sql,
      new Set([
        FOLDER_TABLE,
        // The move's in-UPDATE cycle guard: `ancestors(id, depth)` is the recursive CTE that climbs
        // from the new parent, and `parent` aliases the folder table inside its recursive term.
        "ancestors",
        "depth",
        "parent",
        ...columnsOf(folder),
      ]),
      "folder",
    );
  });

  it("file + version + session SQL names only schema identifiers", () => {
    const stub = stubDatabase();
    const allowed = new Set([
      FILE_TABLE,
      FILE_VERSION_TABLE,
      UPLOAD_SESSION_TABLE,
      "f",
      "v",
      "n",
      "hash",
      ...columnsOf(file),
      ...columnsOf(fileVersion),
      ...columnsOf(uploadSession),
    ]);
    const sql = [
      sqlOf(
        insertFileStatement(stub, {
          id: F,
          matterId: M,
          folderId: null,
          name: "n",
          documentTypeId: null,
          createdAt: "t",
        }),
      ),
      sqlOf(selectFileStatement(stub, F)),
      sqlOf(renameFileStatement(stub, F, "n", "t")),
      sqlOf(moveFileStatement(stub, F, null, "t")),
      sqlOf(assignDocumentTypeStatement(stub, F, null, "t")),
      sqlOf(softDeleteFileStatement(stub, F, "t")),
      sqlOf(selectFolderFileStatement(stub, FOLD)),
      sqlOf(
        insertFileVersionStatement(stub, {
          id: V,
          fileId: F,
          versionNumber: 1,
          r2Key: "k",
          declaredContentType: null,
          uploadedBy: null,
          createdAt: "t",
        }),
      ),
      sqlOf(selectMaxVersionNumberStatement(stub, F)),
      sqlOf(selectPendingVersionStatement(stub, V)),
      sqlOf(selectCurrentVersionHashStatement(stub, F)),
      sqlOf(
        commitVersionStatement(stub, {
          versionId: V,
          sizeBytes: 1,
          sniffedContentType: null,
          contentSha256: "h",
          scanVerdict: "unscanned",
          scanEngineVersion: null,
          scanDetail: null,
          committedAt: "t",
        }),
      ),
      sqlOf(bumpFileCurrentVersionStatement(stub, F, V, "t")),
      sqlOf(quarantineVersionStatement(stub, V, null)),
      sqlOf(abandonVersionStatement(stub, V)),
      sqlOf(
        insertUploadSessionStatement(stub, {
          id: "uploadSession_x" as never,
          fileVersionId: V,
          mode: "put",
          declaredSize: null,
          declaredContentType: null,
          createdAt: "t",
          expiresAt: null,
        }),
      ),
      sqlOf(setUploadSessionStatusStatement(stub, V, "completed")),
    ].join("\n");
    expectKnown(sql, allowed, "file");
  });

  it("query SQL names only schema identifiers", () => {
    const stub = stubDatabase();
    const allowed = new Set([
      FILE_TABLE,
      FILE_VERSION_TABLE,
      UPLOAD_SESSION_TABLE,
      // Statement aliases: f=file, v/dv=file_version (dv is the "display version" the summary JOIN
      // resolves), lv=the latest pending/quarantined version in the include-mode COALESCE subquery,
      // s=upload_session.
      "f",
      "v",
      "dv",
      "lv",
      "s",
      // m=member, joined so a version can name its uploader rather than print their handle. The
      // member table's own columns come in with it: this guard exists to pin the SQL to the schema,
      // so a joined table is added here WITH its columns rather than its alias being waved through.
      MEMBER_TABLE,
      "m",
      // p=file_version_participant and pm=the member row each participant is named from, in the
      // versions read's participants subquery; the participant table's columns come in with it.
      FILE_VERSION_PARTICIPANT_TABLE,
      "p",
      "pm",
      // The two SQLite functions that subquery composes its answer with: group_concat folds the
      // participants into one column, char() supplies the separators between and inside pairs.
      "group_concat",
      "char",
      // SELECT-list projection aliases (dv.status AS version_status, s.status AS session_status,
      // m.display_name AS uploaded_by_name, the participants subquery AS participants).
      "version_status",
      "session_status",
      "uploaded_by_name",
      "participants",
      ...columnsOf(file),
      ...columnsOf(fileVersion),
      ...columnsOf(fileVersionParticipant),
      ...columnsOf(uploadSession),
      ...columnsOf(member),
    ]);
    const sql = [
      sqlOf(
        listFilesStatement(
          stub,
          { matterId: M, folderId: FOLD, includeDeleted: true },
          { createdAt: "t", id: "file_x" },
          10,
        ),
      ),
      // Include mode resolves the display version through the pending/quarantined COALESCE subquery
      // (the `lv` alias); guard its SQL against schema drift too.
      sqlOf(
        listFilesStatement(
          stub,
          { matterId: M, folderId: FOLD, includePendingAndQuarantined: true },
          undefined,
          10,
        ),
      ),
      sqlOf(selectFileSummaryStatement(stub, F)),
      sqlOf(selectCurrentCleanVersionStatement(stub, F)),
      sqlOf(listCleanVersionsStatement(stub, F)),
      sqlOf(selectUploadSessionStatusStatement(stub, "uploadSession_x" as never)),
    ].join("\n");
    expectKnown(sql, allowed, "queries");
  });

  it("document-type SQL names only schema identifiers", () => {
    const stub = stubDatabase();
    const typeId = "documentType_x" as never;
    const sql = [
      sqlOf(
        insertDocumentTypeStatement(stub, { id: typeId, name: "n", code: "c", createdAt: "t" }),
      ),
      sqlOf(updateDocumentTypeStatement(stub, typeId, "n", "c", "t")),
      sqlOf(deactivateDocumentTypeStatement(stub, typeId, "t")),
      sqlOf(selectDocumentTypeStatement(stub, typeId)),
      sqlOf(selectDocumentTypeIdByNameStatement(stub, "n")),
      sqlOf(selectDocumentTypeIdByCodeStatement(stub, "c")),
    ].join("\n");
    expectKnown(sql, new Set([DOCUMENT_TYPE_TABLE, ...columnsOf(documentType)]), "document-type");
  });

  it("storage-meter SQL names only schema identifiers", () => {
    const stub = stubDatabase();
    const sql = meterCommitStatements(
      stub,
      { storageClass: "standard", artifactRole: "original", prefix: "files" },
      1,
    )
      .map(sqlOf)
      .join("\n");
    // `excluded` is SQLite's upsert pseudo-table for ON CONFLICT DO UPDATE.
    expectKnown(
      sql,
      new Set([STORAGE_METER_TABLE, "excluded", ...columnsOf(storageMeter)]),
      "meter",
    );
  });
});
