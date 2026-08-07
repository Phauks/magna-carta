import { describe, expect, it } from "vitest";
import type {
  DiscoveryLoadId,
  ReviewDocumentId,
  ReviewSetId,
} from "@magna-carta/identifiers/types";
import {
  DISCOVERY_R2_PREFIX,
  loadExceptionReportKey,
  loadExceptionReportTextKey,
  loadManifestKey,
  loadManifestTextKey,
  reviewDocumentMetadataKey,
  reviewDocumentTextKey,
  reviewSetDerivedPrefixes,
} from "../src/r2-keys.ts";

const reviewSetId = "reviewSet_HxK2mQ4vTn8pLc7Wd3RbY" as ReviewSetId;
const loadId = "discoveryLoad_9Jf4wRt6Kn2mVc8XbQ5Zp" as DiscoveryLoadId;
const reviewDocumentId = "reviewDocument_Lp3Nq7Vx2Bt9Km5Wd8Rc4" as ReviewDocumentId;

// EVERY KEY IS DERIVED, never stored — which is what makes a re-processing land on the same object
// and a replay converge rather than duplicate. Because it is derived, its exact bytes are a
// compatibility contract with the objects already in the bucket: these fixtures are byte-identical
// pins, and changing one is changing where every existing object lives.
describe("the derived R2 layout", () => {
  it("pins the record artifacts byte for byte", () => {
    expect(loadManifestKey(reviewSetId, loadId)).toBe(
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/loads/discoveryLoad_9Jf4wRt6Kn2mVc8XbQ5Zp/manifest.json",
    );
    expect(loadManifestTextKey(reviewSetId, loadId)).toBe(
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/loads/discoveryLoad_9Jf4wRt6Kn2mVc8XbQ5Zp/manifest.txt",
    );
    expect(loadExceptionReportKey(reviewSetId, loadId)).toBe(
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/loads/discoveryLoad_9Jf4wRt6Kn2mVc8XbQ5Zp/exceptions.json",
    );
    expect(loadExceptionReportTextKey(reviewSetId, loadId)).toBe(
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/loads/discoveryLoad_9Jf4wRt6Kn2mVc8XbQ5Zp/exceptions.txt",
    );
  });

  it("pins the derived artifacts byte for byte", () => {
    expect(reviewDocumentTextKey(reviewSetId, reviewDocumentId)).toBe(
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/text/reviewDocument_Lp3Nq7Vx2Bt9Km5Wd8Rc4.txt",
    );
    expect(reviewDocumentMetadataKey(reviewSetId, reviewDocumentId)).toBe(
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/metadata/reviewDocument_Lp3Nq7Vx2Bt9Km5Wd8Rc4.json",
    );
  });

  it("is deterministic — the same identifiers always produce the same key", () => {
    expect(reviewDocumentTextKey(reviewSetId, reviewDocumentId)).toBe(
      reviewDocumentTextKey(reviewSetId, reviewDocumentId),
    );
  });

  // CLOSING A REVIEW SET RELEASES A CACHE AND NEVER A RECORD. The manifests and exception reports
  // under `loads/` are deliberately outside the collectable prefixes: they are the artifacts a firm
  // hands to opposing counsel, and they are kept.
  it("makes the derived artifacts collectable and leaves the records alone", () => {
    const prefixes = reviewSetDerivedPrefixes(reviewSetId);
    expect(prefixes).toEqual([
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/text/",
      "discovery/reviewSet_HxK2mQ4vTn8pLc7Wd3RbY/metadata/",
    ]);
    const manifest = loadManifestKey(reviewSetId, loadId);
    const exceptions = loadExceptionReportKey(reviewSetId, loadId);
    for (const prefix of prefixes) {
      expect(manifest.startsWith(prefix)).toBe(false);
      expect(exceptions.startsWith(prefix)).toBe(false);
    }
    // Both are still inside the review set's own tree, so nothing escapes the firm's layout.
    expect(manifest.startsWith(`${DISCOVERY_R2_PREFIX}/${reviewSetId}/`)).toBe(true);
  });

  // NATIVE BYTES ARE NOT IN THIS LAYOUT. A review document points at a File Manager object at a File
  // Manager key; nothing here copies one, which is what removes the largest storage line discovery
  // would otherwise add and keeps ONE answer to "is this file under hold".
  it("has no key for original bytes", () => {
    const everyKey = [
      loadManifestKey(reviewSetId, loadId),
      loadManifestTextKey(reviewSetId, loadId),
      loadExceptionReportKey(reviewSetId, loadId),
      loadExceptionReportTextKey(reviewSetId, loadId),
      reviewDocumentTextKey(reviewSetId, reviewDocumentId),
      reviewDocumentMetadataKey(reviewSetId, reviewDocumentId),
    ];
    for (const key of everyKey) {
      expect(key).not.toContain("/originals/");
      expect(key).not.toContain("/native/");
      expect(key.startsWith(`${DISCOVERY_R2_PREFIX}/`)).toBe(true);
    }
  });
});
