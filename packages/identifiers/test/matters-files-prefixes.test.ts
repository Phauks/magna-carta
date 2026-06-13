import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import { ENTITY_PREFIXES } from "../src/registry.ts";
import type {
  AuditLogId,
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  LocationId,
  MatterTypeId,
  NumberingSchemeId,
  UploadSessionId,
} from "../src/types.ts";

describe("matters / locations / file-manager identifier prefixes", () => {
  it("registers the new prefixes without colliding with existing ones", () => {
    expect(ENTITY_PREFIXES.location).toBe("loc");
    expect(ENTITY_PREFIXES.matterType).toBe("mtt");
    expect(ENTITY_PREFIXES.documentType).toBe("dty");
    expect(ENTITY_PREFIXES.numberingScheme).toBe("nsc");
    expect(ENTITY_PREFIXES.folder).toBe("fld");
    expect(ENTITY_PREFIXES.file).toBe("fil");
    expect(ENTITY_PREFIXES.fileVersion).toBe("fvr");
    expect(ENTITY_PREFIXES.uploadSession).toBe("upl");
    expect(ENTITY_PREFIXES.auditLog).toBe("alg");
  });

  it("mints handles with the new prefixes and the branded aliases compile", () => {
    const locationId: LocationId = newIdentifier("location");
    const matterTypeId: MatterTypeId = newIdentifier("matterType");
    const documentTypeId: DocumentTypeId = newIdentifier("documentType");
    const numberingSchemeId: NumberingSchemeId = newIdentifier("numberingScheme");
    const folderId: FolderId = newIdentifier("folder");
    const fileId: FileId = newIdentifier("file");
    const fileVersionId: FileVersionId = newIdentifier("fileVersion");
    const uploadSessionId: UploadSessionId = newIdentifier("uploadSession");
    const auditLogId: AuditLogId = newIdentifier("auditLog");

    expect(locationId).toMatch(/^loc_[A-Za-z0-9_-]{21}$/);
    expect(matterTypeId).toMatch(/^mtt_[A-Za-z0-9_-]{21}$/);
    expect(documentTypeId).toMatch(/^dty_[A-Za-z0-9_-]{21}$/);
    expect(numberingSchemeId).toMatch(/^nsc_[A-Za-z0-9_-]{21}$/);
    expect(folderId).toMatch(/^fld_[A-Za-z0-9_-]{21}$/);
    expect(fileId).toMatch(/^fil_[A-Za-z0-9_-]{21}$/);
    expect(fileVersionId).toMatch(/^fvr_[A-Za-z0-9_-]{21}$/);
    expect(uploadSessionId).toMatch(/^upl_[A-Za-z0-9_-]{21}$/);
    expect(auditLogId).toMatch(/^alg_[A-Za-z0-9_-]{21}$/);
  });
});
