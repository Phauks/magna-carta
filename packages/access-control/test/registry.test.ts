import { describe, expect, it } from "vitest";
import {
  assertPermission,
  isPermission,
  PERMISSIONS,
  permissionsForNamespace,
} from "../src/registry.ts";

describe("permission registry", () => {
  it("recognizes every registered permission key", () => {
    for (const key of PERMISSIONS) {
      expect(isPermission(key)).toBe(true);
    }
    expect(isPermission("firm:manageMembers")).toBe(true);
    expect(isPermission("firm:provision")).toBe(true);
  });

  it("rejects unknown keys", () => {
    expect(isPermission("firm:deleteEverything")).toBe(false);
    expect(isPermission("matter:read")).toBe(false);
  });

  it("rejects malformed shapes (no namespace, no action, wrong case, padding)", () => {
    expect(isPermission("")).toBe(false);
    expect(isPermission("firm")).toBe(false);
    expect(isPermission("firm:")).toBe(false);
    expect(isPermission(":manageMembers")).toBe(false);
    expect(isPermission("FIRM:MANAGEMEMBERS")).toBe(false);
    expect(isPermission(" firm:manageMembers")).toBe(false);
    expect(isPermission("firm:manageMembers ")).toBe(false);
  });

  it("assertPermission returns the narrowed value for a known key", () => {
    const permission = assertPermission("firm:manageMembers");
    expect(permission).toBe("firm:manageMembers");
  });

  it("assertPermission throws a TypeError naming the JSON-quoted offending value", () => {
    expect(() => assertPermission("firm:deleteEverything")).toThrowError(TypeError);
    expect(() => assertPermission("firm:deleteEverything")).toThrowError('"firm:deleteEverything"');
    expect(() => assertPermission("")).toThrowError(TypeError);
  });

  it("permissionsForNamespace('firm') returns exactly the firm keys", () => {
    expect(permissionsForNamespace("firm")).toEqual([
      "firm:manageMembers",
      "firm:readMembers",
      "firm:provision",
      "firm:reportIncident",
      "firm:scanFile",
      "firm:manageSecrets",
      "firm:manageScanPolicy",
      "firm:manageEditingPolicy",
      "firm:manageReleaseChannel",
      "firm:manageNotificationPolicy",
      "firm:manageReportPolicy",
      "firm:manageProfile",
      "firm:editOwnProfile",
      "firm:manageAiSettings",
    ]);
  });

  it("permissionsForNamespace('matters') returns exactly the matters keys, in registry order", () => {
    expect(permissionsForNamespace("matters")).toEqual([
      "matters:create",
      "matters:open",
      "matters:close",
      "matters:reopen",
      "matters:hold",
      "matters:edit",
      "matters:renumber",
      "matters:manageTypes",
      "matters:manageNumbering",
    ]);
  });

  it("permissionsForNamespace('directory') returns exactly the directory keys", () => {
    expect(permissionsForNamespace("directory")).toEqual([
      "directory:edit",
      "directory:viewSensitiveIdentifiers",
    ]);
  });

  it("permissionsForNamespace('locations') returns exactly the locations keys", () => {
    expect(permissionsForNamespace("locations")).toEqual(["locations:manage"]);
  });

  it("permissionsForNamespace('shipping') returns exactly the shipping keys", () => {
    expect(permissionsForNamespace("shipping")).toEqual(["shipping:manage"]);
  });

  it("permissionsForNamespace('files') returns exactly the files keys, in registry order", () => {
    expect(permissionsForNamespace("files")).toEqual([
      "files:upload",
      "files:organize",
      "files:delete",
      "files:manageDocumentTypes",
    ]);
  });

  it("permissionsForNamespace('emails') returns exactly the emails keys, in registry order", () => {
    expect(permissionsForNamespace("emails")).toEqual([
      "emails:file",
      "emails:read",
      "emails:manageLinks",
      "emails:manageAutoFileRules",
      "emails:manageCaptureAddresses",
    ]);
  });

  it("permissionsForNamespace('tools') returns exactly the tools keys, in registry order", () => {
    expect(permissionsForNamespace("tools")).toEqual([
      "tools:propertyListings",
      "tools:propertyRecords",
      "tools:businessLookup",
      "tools:attorneyLicense",
      "tools:shipping",
      "tools:speedTest",
      "tools:firmUsage",
      "tools:whois",
      "tools:safeBrowse",
      "tools:decryption",
      "tools:fileConverter",
      "tools:aiTextDetection",
      "tools:metadataScrubber",
      "tools:fileIntegrity",
      "tools:fileTypeVerifier",
      "tools:fileRepair",
      "tools:ocr",
      "tools:emailInspector",
      "tools:fileWorkbench",
    ]);
  });

  it("permissionsForNamespace('documents') returns exactly the documents keys, in registry order", () => {
    expect(permissionsForNamespace("documents")).toEqual([
      "documents:edit",
      "documents:checkout",
      "documents:forceReleaseLock",
      "documents:reconcile",
      "documents:assemble",
    ]);
  });

  it("permissionsForNamespace('discovery') returns exactly the discovery keys, in registry order", () => {
    expect(permissionsForNamespace("discovery")).toEqual([
      "discovery:read",
      "discovery:manageReviewSets",
      "discovery:load",
      "discovery:review",
      "discovery:produce",
    ]);
  });

  // The access rule the discovery namespace exists to carry: reaching a review set follows from a
  // discovery grant and from nothing else. A member holding every matters:* and files:* key on the
  // matter holds no discovery key by that fact, because material produced by another party may be
  // attorney's-eyes-only under a protective order.
  it("no matters:* or files:* key is a discovery key", () => {
    const discoveryKeys = new Set<string>(permissionsForNamespace("discovery"));
    for (const key of [
      ...permissionsForNamespace("matters"),
      ...permissionsForNamespace("files"),
    ]) {
      expect(discoveryKeys.has(key)).toBe(false);
    }
    expect(discoveryKeys.size).toBe(5);
  });

  it("permissionsForNamespace returns an empty list for an unknown namespace", () => {
    // 'matter' (singular) is NOT the matters namespace — the keys live under 'matters'.
    expect(permissionsForNamespace("matter")).toEqual([]);
  });

  it("permissionsForNamespace matches the whole namespace, not a prefix of it", () => {
    expect(permissionsForNamespace("fir")).toEqual([]);
    expect(permissionsForNamespace("")).toEqual([]);
  });

  it("registers the custom-fields permissions", () => {
    expect(isPermission("customFields:manage")).toBe(true);
    expect(isPermission("customFields:purge")).toBe(true);
  });

  it("permissionsForNamespace('time') returns exactly the time keys, in registry order", () => {
    expect(permissionsForNamespace("time")).toEqual([
      "time:track",
      "time:viewFirm",
      "time:approve",
      "time:manageRates",
      "time:manageUtbms",
      "time:manageSettings",
    ]);
  });

  it("permissionsForNamespace('costs') returns exactly the costs keys, in registry order", () => {
    expect(permissionsForNamespace("costs")).toEqual(["costs:track", "costs:approve"]);
  });

  it("registers the costs permissions", () => {
    expect(isPermission("costs:track")).toBe(true);
    expect(isPermission("costs:approve")).toBe(true);
  });

  it("web-domains tool permissions are registered", () => {
    expect(isPermission("tools:whois")).toBe(true);
    expect(isPermission("tools:safeBrowse")).toBe(true);
  });

  it("registers firm:manageReleaseChannel", () => {
    expect(isPermission("firm:manageReleaseChannel")).toBe(true);
  });

  it("every registered key is `<subsystem>:<action>` — lowercase-led camelCase segments", () => {
    for (const key of PERMISSIONS) {
      expect(key).toMatch(/^[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$/);
    }
  });

  it("has no duplicate keys", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("permissionsForNamespace('support') returns exactly the support keys, in registry order", () => {
    expect(permissionsForNamespace("support")).toEqual([
      "support:request",
      "support:cosign",
      "support:manage",
      "support:mintSession",
    ]);
  });

  it("permissionsForNamespace('diagnostics') returns exactly the diagnostics keys", () => {
    expect(permissionsForNamespace("diagnostics")).toEqual(["diagnostics:overview"]);
  });

  it("registers the support and diagnostics permission keys", () => {
    expect(isPermission("support:request")).toBe(true);
    expect(isPermission("support:cosign")).toBe(true);
    expect(isPermission("support:manage")).toBe(true);
    expect(isPermission("support:mintSession")).toBe(true);
    expect(isPermission("diagnostics:overview")).toBe(true);
  });

  it("registers the AI-text detection tool permission", () => {
    expect(isPermission("tools:aiTextDetection")).toBe(true);
  });

  it("registers the file-repair tool permission", () => {
    expect(isPermission("tools:fileRepair")).toBe(true);
  });

  it("registers the ocr tool permission", () => {
    expect(isPermission("tools:ocr")).toBe(true);
  });

  it("permissionsForNamespace('notifications') returns exactly the notifications key", () => {
    expect(permissionsForNamespace("notifications")).toEqual(["notifications:read"]);
  });

  it("permissionsForNamespace('reports') returns exactly the reports keys, in registry order", () => {
    expect(permissionsForNamespace("reports")).toEqual([
      "reports:trustCompliance",
      "reports:financial",
      "reports:productivity",
      "reports:operational",
      "reports:produce",
      "reports:export",
    ]);
  });

  it("permissionsForNamespace('billing') returns exactly the billing keys, in registry order", () => {
    expect(permissionsForNamespace("billing")).toEqual([
      "billing:read",
      "billing:draft",
      "billing:finalize",
      "billing:apply",
      "billing:credit",
      "billing:configure",
    ]);
  });
});
