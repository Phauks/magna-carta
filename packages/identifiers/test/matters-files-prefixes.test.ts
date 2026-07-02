import { describe, expect, it } from "vitest";
import { newIdentifier } from "../src/generate.ts";
import type {
  AuditLogId,
  DocumentTypeId,
  FileId,
  FileVersionId,
  FolderId,
  LocationAddressId,
  LocationId,
  MatterTypeId,
  MemberLocationId,
  NumberingSchemeId,
  UploadSessionId,
} from "../src/types.ts";

describe("matters / locations / file-manager identifier prefixes", () => {
  it("mints handles with the full-name prefixes and the branded aliases compile", () => {
    const locationId: LocationId = newIdentifier("location");
    const locationAddressId: LocationAddressId = newIdentifier("locationAddress");
    const memberLocationId: MemberLocationId = newIdentifier("memberLocation");
    const matterTypeId: MatterTypeId = newIdentifier("matterType");
    const documentTypeId: DocumentTypeId = newIdentifier("documentType");
    const numberingSchemeId: NumberingSchemeId = newIdentifier("numberingScheme");
    const folderId: FolderId = newIdentifier("folder");
    const fileId: FileId = newIdentifier("file");
    const fileVersionId: FileVersionId = newIdentifier("fileVersion");
    const uploadSessionId: UploadSessionId = newIdentifier("uploadSession");
    const auditLogId: AuditLogId = newIdentifier("auditLog");

    expect(locationId).toMatch(/^location_[A-Za-z0-9_-]{21}$/);
    expect(locationAddressId).toMatch(/^locationAddress_[A-Za-z0-9_-]{21}$/);
    expect(memberLocationId).toMatch(/^memberLocation_[A-Za-z0-9_-]{21}$/);
    expect(matterTypeId).toMatch(/^matterType_[A-Za-z0-9_-]{21}$/);
    expect(documentTypeId).toMatch(/^documentType_[A-Za-z0-9_-]{21}$/);
    expect(numberingSchemeId).toMatch(/^numberingScheme_[A-Za-z0-9_-]{21}$/);
    expect(folderId).toMatch(/^folder_[A-Za-z0-9_-]{21}$/);
    expect(fileId).toMatch(/^file_[A-Za-z0-9_-]{21}$/);
    expect(fileVersionId).toMatch(/^fileVersion_[A-Za-z0-9_-]{21}$/);
    expect(uploadSessionId).toMatch(/^uploadSession_[A-Za-z0-9_-]{21}$/);
    expect(auditLogId).toMatch(/^auditLog_[A-Za-z0-9_-]{21}$/);
  });
});
